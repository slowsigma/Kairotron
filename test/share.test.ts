import { describe, expect, it } from "vitest";
import {
  SHARE_PARAM,
  buildShareUrl,
  decodeShareParam,
  encodeShareParam,
  readShareParam,
  type SharePayload,
} from "../web/src/share.js";

const CODE = `model({
  stocks: { " pré ": 100 }, // unicode + spaces exercise the byte path
  rules: [flow("pré", rate(5, "year"), { label: "d\u00e9rive" })],
})`;

describe("share URL codec", () => {
  it("round-trips the full payload through deflate", async () => {
    const payload: SharePayload = {
      code: CODE,
      horizon: { start: "", end: "20", unit: "month", convention: "actual/365" },
      mc: { paths: "200", seed: "7" },
      playhead: 12,
      branches: [{ forkT: 6, code: CODE.replace("rate(5", "rate(9") }],
    };
    const encoded = await encodeShareParam(payload);
    const back = await decodeShareParam(encoded);
    // empty horizon strings are dropped by validation, everything else survives
    expect(back).toEqual({ ...payload, horizon: { end: "20", unit: "month", convention: "actual/365" } });
  });

  it("round-trips through the uncompressed fallback", async () => {
    const savedC = (globalThis as Record<string, unknown>).CompressionStream;
    const savedD = (globalThis as Record<string, unknown>).DecompressionStream;
    delete (globalThis as Record<string, unknown>).CompressionStream;
    try {
      const encoded = await encodeShareParam({ code: CODE, playhead: 3 });
      expect(encoded[0]).toBe("j"); // no CompressionStream → plain JSON
      expect(await decodeShareParam(encoded)).toMatchObject({ playhead: 3 });
    } finally {
      (globalThis as Record<string, unknown>).CompressionStream = savedC;
      (globalThis as Record<string, unknown>).DecompressionStream = savedD;
    }
  });

  it("deflate beats plain JSON on real model text", async () => {
    const code = "model({\n" + "  flow(\"growth\", rate(4000, \"year\")),\n".repeat(20) + "})";
    const z = await encodeShareParam({ code });
    const saved = (globalThis as Record<string, unknown>).CompressionStream;
    delete (globalThis as Record<string, unknown>).CompressionStream;
    const j = await encodeShareParam({ code });
    (globalThis as Record<string, unknown>).CompressionStream = saved;
    expect(z[0]).toBe("z");
    expect(z.length).toBeLessThan(j.length);
  });

  it("rejects malformed parameters and junk payloads", async () => {
    await expect(decodeShareParam("")).rejects.toThrow(/share encoding/);
    await expect(decodeShareParam("xZZZZ")).rejects.toThrow(/share encoding 'x'/);
    await expect(decodeShareParam("q!not base64!")).rejects.toThrow(/base64url/);
    const junk = `j${btoa(JSON.stringify({ nope: true }))}`;
    await expect(decodeShareParam(junk)).rejects.toThrow(/no model code/);
    const notJson = `j${btoa("this is not json")}`;
    await expect(decodeShareParam(notJson)).rejects.toThrow(/not decode to JSON/);
  });

  it("round-trips per-branch horizons from cross-unit shares", async () => {
    const payload: SharePayload = {
      code: "model({a})",
      branches: [
        {
          forkT: 6,
          code: "model({b})",
          horizon: { start: "0", end: "240", unit: "month", convention: "actual/365" },
        },
      ],
    };
    expect(await decodeShareParam(await encodeShareParam(payload))).toEqual(payload);
  });

  it("skips malformed branches instead of failing the whole link", async () => {
    const raw = {
      code: "model({})",
      branches: [{ forkT: 5, code: "b" }, { forkT: NaN, code: "x" }, null, { forkT: 2 }],
    };
    const back = await decodeShareParam(`j${btoa(JSON.stringify(raw))}`);
    expect(back.branches).toEqual([{ forkT: 5, code: "b" }]);
  });

  it("builds and reads the URL, clearing previous query and hash", () => {
    const url = buildShareUrl("http://k.example/repl/?junk=1#frag", "jabc");
    // the path survives verbatim (trailing slash included); junk query & hash drop
    expect(url).toBe(`http://k.example/repl/?${SHARE_PARAM}=jabc`);
    expect(readShareParam(url)).toBe("jabc");
    expect(readShareParam("http://k.example/repl")).toBeUndefined();
    expect(readShareParam(`http://k.example/repl?${SHARE_PARAM}=`)).toBeUndefined();
  });
});
