// Shareable model URLs (plan.md's "later — shareable model URLs"): the trunk's
// model code, the horizon-override controls, the Monte Carlo inputs, the
// playhead, and every branch (fork tick + buffer) ride in one query parameter,
// so a link reproduces the whole session — not just the model text.
//
// Wire format: `?m=<kind><base64url>`, kind 'z' = deflate-raw, 'j' = plain
// UTF-8 JSON (the fallback where CompressionStream is unavailable). Both
// encoders/decoders are pure async functions over bytes so the codec is
// testable outside the DOM.

export const SHARE_PARAM = "m";

// Raw horizon-control values (the toolbar inputs), absent = auto. On a branch
// these are the branch's own tick unit, so share branches carry their own copy.
export interface ShareHorizon {
  start?: string;
  end?: string;
  unit?: string;
  convention?: string;
}

export interface ShareBranch {
  forkT: number; // trunk tick
  code: string;
  horizon?: ShareHorizon; // only when it differs from the trunk's
}

export interface SharePayload {
  code: string; // trunk editor buffer (the last-run code)
  horizon?: ShareHorizon; // trunk horizon/control values, absent = auto
  mc?: { paths?: string; seed?: string }; // raw input values, absent = deterministic
  playhead?: number; // trunk tick
  branches?: ShareBranch[];
}

const canDeflate = (): boolean =>
  typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

const bytesToB64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlToBytes = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// lib.dom and @types/node disagree on the compression streams' chunk type
// (`any` vs `BufferSource`), so the two facades are pinned to the byte-only
// duplex pipeThrough actually needs — writes are always Uint8Array.
type Duplex = {
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
};

const deflateRaw = (): Duplex => new CompressionStream("deflate-raw") as unknown as Duplex;
const inflateRaw = (): Duplex => new DecompressionStream("deflate-raw") as unknown as Duplex;

async function pipeThrough(bytes: Uint8Array, duplex: Duplex): Promise<Uint8Array> {
  const writer = duplex.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  const reader = duplex.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function encodeShareParam(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (canDeflate()) return `z${bytesToB64url(await pipeThrough(json, deflateRaw()))}`;
  return `j${bytesToB64url(json)}`;
}

export async function decodeShareParam(param: string): Promise<SharePayload> {
  const kind = param[0];
  let bytes: Uint8Array;
  try {
    bytes = b64urlToBytes(param.slice(1));
  } catch {
    throw new Error("share link is not valid base64url");
  }
  if (kind === "z") {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("this browser cannot open compressed share links");
    }
    bytes = await pipeThrough(bytes, inflateRaw());
  } else if (kind !== "j") {
    throw new Error(`unknown share encoding '${kind ?? ""}'`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("share link does not decode to JSON");
  }
  return validatePayload(raw);
}

// Hand-rolled validation (no deps): unknown fields are dropped, malformed
// branches are skipped rather than failing the whole link, and a payload
// without model code is the one hard error. Also reused by the scenario store
// (scenarios.ts) to revalidate localStorage payloads.
export function validatePayload(raw: unknown): SharePayload {
  if (!raw || typeof raw !== "object") throw new Error("share link must carry an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.code !== "string" || o.code.trim() === "") throw new Error("share link carries no model code");
  const strings = (v: unknown, keys: string[]): Record<string, string> | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const src = v as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of keys) if (typeof src[k] === "string" && src[k] !== "") out[k] = src[k] as string;
    return Object.keys(out).length ? out : undefined;
  };
  const horizon = strings(o.horizon, ["start", "end", "unit", "convention"]) as ShareHorizon | undefined;
  const mc = strings(o.mc, ["paths", "seed"]) as SharePayload["mc"];
  const playhead =
    typeof o.playhead === "number" && Number.isFinite(o.playhead) && o.playhead >= 0
      ? Math.floor(o.playhead)
      : undefined;
  const branches = Array.isArray(o.branches)
    ? o.branches.flatMap((b): ShareBranch[] => {
        if (!b || typeof b !== "object") return [];
        const { forkT, code } = b as Record<string, unknown>;
        if (typeof forkT !== "number" || !Number.isFinite(forkT) || typeof code !== "string") return [];
        const out: ShareBranch = { forkT, code };
        const bh = strings((b as Record<string, unknown>).horizon, ["start", "end", "unit", "convention"]);
        if (bh) out.horizon = bh;
        return [out];
      })
    : undefined;
  // exactOptionalPropertyTypes: optional fields stay absent, never undefined
  const out: SharePayload = { code: o.code };
  if (horizon) out.horizon = horizon;
  if (mc) out.mc = mc;
  if (playhead !== undefined) out.playhead = playhead;
  if (branches && branches.length) out.branches = branches;
  return out;
}

// The current href is the base so origin/path (and a static host's subpath)
// survive; any previous query or hash is cleared before the parameter lands.
export function buildShareUrl(currentHref: string, encoded: string): string {
  const url = new URL(currentHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set(SHARE_PARAM, encoded);
  return url.toString();
}

export function readShareParam(href: string): string | undefined {
  const param = new URL(href).searchParams.get(SHARE_PARAM);
  return param === null || param === "" ? undefined : param;
}
