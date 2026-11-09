import type { Snapshot } from "../../src/core/types.js";

export type ChartMode = "stacked" | "lines";

export interface LegendEntry {
  name: string;
  color: string;
  value: number;
}

// The trunk continuation drawn behind an active branch: the path not taken,
// dashed and faint (Strudel's ghost-pattern trick, aimed at what-ifs).
export interface Ghost {
  snapshots: readonly Snapshot[];
  forkT: number;
}

export const PALETTE = [
  "#8ab4ff", "#ffab70", "#7edb9a", "#ff8fb3", "#5bdcd0",
  "#f2cf5b", "#c39bf5", "#ff7a7a", "#89b7c9", "#b8c97e",
];

export const colorOf = (i: number): string => PALETTE[i % PALETTE.length];

const W = 900;
const PL = 58;
const PR = 10;
const PT = 10;
const PB = 20;

export const chartNames = (snap: Snapshot): string[] => Object.keys(snap.stocks);
export const derivedNames = (snap: Snapshot): string[] => Object.keys(snap.derived);

// Union across snapshots, first-appearance order: a fork branch carries the
// trunk's stocks in its shared prefix and a variant may add new ones, and
// first-appearance order keeps colors stable across branch switches.
export function stockNamesOf(history: readonly Snapshot[]): string[] {
  const names = new Set<string>();
  for (const s of history) for (const k of Object.keys(s.stocks)) names.add(k);
  return [...names];
}

const fmtNum = (v: number, digits = 2): string =>
  v.toLocaleString("en", { maximumFractionDigits: digits });

const fmtAxis = (v: number): string =>
  Math.abs(v) >= 10000
    ? v.toLocaleString("en", { notation: "compact", maximumSignificantDigits: 3 })
    : fmtNum(v, Math.abs(v) >= 100 ? 0 : 2);

const xFor = (t: number, t0: number, tN: number): number =>
  PL + ((tN === t0 ? 0 : (t - t0) / (tN - t0)) * (W - PL - PR));

export function tickAt(svg: SVGSVGElement, clientX: number, t0: number, tN: number): number {
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * W;
  const frac = Math.min(1, Math.max(0, (x - PL) / (W - PL - PR)));
  return Math.round(t0 + frac * (tN - t0));
}

function grid(h: number, yOf: (v: number) => number, min: number, max: number, t0: number, tN: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    const y = yOf(v);
    parts.push(`<line class="grid" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"/>`);
    parts.push(`<text x="4" y="${y + 3}">${fmtAxis(v)}</text>`);
  }
  const span = tN - t0;
  const step = Math.max(1, Math.round(span / 6));
  for (let t = t0; t <= tN; t += step) {
    parts.push(`<text x="${xFor(t, t0, tN) - 8}" y="${h - 6}">${t}</text>`);
  }
  return parts.join("");
}

function playheadMarkup(t: number, t0: number, tN: number, h: number, forkT?: number): string {
  const x = xFor(t, t0, tN);
  const fork =
    forkT !== undefined && forkT > t0
      ? `<line class="fork" x1="${xFor(forkT, t0, tN)}" y1="${PT}" x2="${xFor(forkT, t0, tN)}" y2="${h - PB}"/>`
      : "";
  return fork + `<line class="playhead" x1="${x}" y1="${PT}" x2="${x}" y2="${h - PB}"/>`;
}

export const visibleSpan = (history: readonly Snapshot[], ghost?: Ghost): { t0: number; tN: number } => ({
  t0: history[0].t,
  tN: ghost
    ? Math.max(history[history.length - 1]!.t, ghost.snapshots[ghost.snapshots.length - 1]!.t)
    : history[history.length - 1]!.t,
});

// Dashed after-fork continuation of the trunk, drawn under the active branch.
function ghostLines(
  ghost: Ghost | undefined,
  names: string[],
  colorIndex: (name: string) => number,
  yOf: (v: number) => number,
  t0: number,
  tN: number,
  pick: (s: Snapshot, n: string) => number | undefined,
): string {
  if (!ghost) return "";
  const after = ghost.snapshots.filter((s) => s.t >= ghost.forkT);
  if (after.length < 2) return "";
  return names
    .map((n) => {
      const pts = after.flatMap((s) => {
        const v = pick(s, n);
        return v === undefined ? [] : [`${xFor(s.t, t0, tN)},${yOf(v)}`];
      });
      if (pts.length < 2) return "";
      return `<polyline fill="none" stroke="${colorOf(colorIndex(n))}" stroke-width="1.2" stroke-opacity="0.4" stroke-dasharray="4 3" points="${pts.join("L")}"/>`;
    })
    .join("");
}

export function renderStocks(
  svg: SVGSVGElement,
  history: readonly Snapshot[],
  playheadT: number,
  mode: ChartMode,
  hidden: ReadonlySet<string>,
  ghost?: Ghost,
): LegendEntry[] {
  const h = 280;
  if (history.length === 0) {
    svg.innerHTML = "";
    return [];
  }
  const all = stockNamesOf(history);
  const names = all.filter((n) => !hidden.has(n));
  const { t0, tN } = visibleSpan(history, ghost);
  const series = names.map((n) => history.map((s) => s.stocks[n] ?? 0));
  const ghostPick = (s: Snapshot, n: string): number | undefined => s.stocks[n];

  const areas: string[] = [];
  let min = 0;
  let max = 1;
  if (mode === "stacked") {
    max = 1;
    for (let i = 0; i < history.length; i++) {
      let sum = 0;
      for (let j = 0; j < names.length; j++) sum += Math.max(0, series[j][i]);
      if (sum > max) max = sum;
    }
    if (ghost)
      for (const s of ghost.snapshots)
        for (const n of names) max = Math.max(max, s.stocks[n] ?? 0);
    const yOf = (v: number) => PT + (1 - v / max) * (h - PT - PB);
    const base = history.map(() => 0);
    for (let j = 0; j < names.length; j++) {
      const color = colorOf(all.indexOf(names[j]!));
      const top: string[] = [];
      const bottom: string[] = [];
      history.forEach((s, i) => {
        const v = Math.max(0, series[j][i]);
        top.push(`${xFor(s.t, t0, tN)},${yOf(base[i] + v)}`);
        bottom.unshift(`${xFor(s.t, t0, tN)},${yOf(base[i])}`);
        base[i] += v;
      });
      areas.push(`<path fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="1" d="M${top.join("L")}L${bottom.join("L")}Z"/>`);
    }
    const ghostSvg = ghostLines(ghost, names, (n) => all.indexOf(n), yOf, t0, tN, ghostPick);
    svg.innerHTML =
      grid(h, yOf, 0, max, t0, tN) + ghostSvg + areas.join("") + playheadMarkup(playheadT, t0, tN, h, ghost?.forkT);
  } else {
    min = Infinity;
    max = -Infinity;
    for (const vals of series) for (const v of vals) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (ghost)
      for (const s of ghost.snapshots)
        for (const n of names) {
          const v = s.stocks[n];
          if (v !== undefined) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
    if (min === max) max = min + 1;
    const yOf = (v: number) => PT + (1 - (v - min) / (max - min)) * (h - PT - PB);
    for (let j = 0; j < names.length; j++) {
      const color = colorOf(all.indexOf(names[j]!));
      const pts = history.map((s, i) => `${xFor(s.t, t0, tN)},${yOf(series[j][i])}`).join("L");
      areas.push(`<polyline fill="none" stroke="${color}" stroke-width="1.8" points="${pts}"/>`);
    }
    const zero = min < 0 && max > 0 ? `<line class="zero" x1="${PL}" y1="${yOf(0)}" x2="${W - PR}" y2="${yOf(0)}"/>` : "";
    const ghostSvg = ghostLines(ghost, names, (n) => all.indexOf(n), yOf, t0, tN, ghostPick);
    svg.innerHTML =
      grid(h, yOf, min, max, t0, tN) + zero + ghostSvg + areas.join("") + playheadMarkup(playheadT, t0, tN, h, ghost?.forkT);
  }

  const snap = history.find((s) => s.t === playheadT) ?? history[0];
  return all.map((n, i) => ({ name: n, color: colorOf(i), value: snap.stocks[n] ?? 0 }));
}

export function renderDerived(
  svg: SVGSVGElement,
  history: readonly Snapshot[],
  playheadT: number,
  hidden: ReadonlySet<string>,
  ghost?: Ghost,
): LegendEntry[] {
  const h = 150;
  if (history.length === 0) {
    svg.innerHTML = "";
    return [];
  }
  const names = derivedNames(history[0]);
  const visible = names.filter((n) => !hidden.has(n));
  const pane = document.getElementById("derived-pane");
  if (names.length === 0 && pane) pane.style.display = "none";
  const { t0, tN } = visibleSpan(history, ghost);
  const paths: string[] = [];
  if (visible.length > 0) {
    // Each derivation gets its own min/max: the pane is a shape probe (curves
    // that live on different scales can't share a y-axis meaningfully); the
    // legend shows the exact value at the playhead.
    visible.forEach((n) => {
      const vals = history.map((s) => s.derived[n] ?? 0);
      let min = Math.min(...vals);
      let max = Math.max(...vals);
      const ghostAfter = ghost
        ? ghost.snapshots.filter((s) => s.t >= ghost.forkT && s.derived[n] !== undefined)
        : [];
      for (const s of ghostAfter) {
        const v = s.derived[n]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min === max) max = min + 1;
      const yOf = (v: number) => PT + (1 - (v - min) / (max - min)) * (h - PT - PB) + 4;
      const pts = history.map((s, i) => `${xFor(s.t, t0, tN)},${yOf(vals[i])}`).join("L");
      const color = colorOf(names.indexOf(n));
      paths.push(`<polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="5 3" points="${pts}"/>`);
      // the trunk's continuation of this derivation, on the same per-curve scale
      if (ghostAfter.length >= 2) {
        const gpts = ghostAfter.map((s) => `${xFor(s.t, t0, tN)},${yOf(s.derived[n]!)}`).join("L");
        paths.push(
          `<polyline fill="none" stroke="${color}" stroke-width="1.1" stroke-opacity="0.35" stroke-dasharray="3 3" points="${gpts}"/>`,
        );
      }
    });
  }
  svg.innerHTML =
    `<line class="grid" x1="${PL}" y1="${PT}" x2="${W - PR}" y2="${PT}"/>` +
    `<text x="4" y="${PT + 8}">derived ~</text>` +
    `<text x="${W - PR - 20}" y="${h - 6}">${tN}</text>` +
    `<text x="${PL}" y="${h - 6}">${t0}</text>` +
    paths.join("") +
    playheadMarkup(playheadT, t0, tN, h, ghost?.forkT);

  const snap = history.find((s) => s.t === playheadT) ?? history[0];
  return names.map((n, i) => ({ name: `~${n}`, color: colorOf(i), value: snap.derived[n] ?? 0 }));
}

// Side-by-side comparison as a single honest view: per stock, branch minus
// trunk after the fork point — "how much better off does this what-if make me?"
export function renderDiff(
  svg: SVGSVGElement,
  trunk: readonly Snapshot[],
  branch: readonly Snapshot[],
  forkT: number,
  playheadT: number,
  hidden: ReadonlySet<string>,
): LegendEntry[] {
  const h = 150;
  if (trunk.length === 0 || branch.length === 0) {
    svg.innerHTML = "";
    return [];
  }
  const all = stockNamesOf(branch);
  const names = all.filter((n) => !hidden.has(n));
  const t0 = branch[0].t;
  const tN = Math.max(trunk[trunk.length - 1]!.t, branch[branch.length - 1]!.t);
  const trunkAt = new Map(trunk.map((s) => [s.t, s]));
  let min = 0;
  let max = 1;
  const deltas = new Map<string, { t: number; d: number }[]>();
  for (const n of names) {
    const pts: { t: number; d: number }[] = [];
    for (const s of branch) {
      if (s.t <= forkT) continue; // the shared prefix is diff-zero by construction
      const v = s.stocks[n];
      const bv = trunkAt.get(s.t)?.stocks[n];
      if (v === undefined || bv === undefined) continue;
      const d = v - bv;
      pts.push({ t: s.t, d });
      if (d < min) min = d;
      if (d > max) max = d;
    }
    deltas.set(n, pts);
  }
  if (min === max) max = min + 1;
  const yOf = (v: number) => PT + (1 - (v - min) / (max - min)) * (h - PT - PB);
  const lines: string[] = [];
  for (const n of names) {
    const pts = deltas.get(n)!;
    if (pts.length < 2) continue;
    lines.push(
      `<polyline fill="none" stroke="${colorOf(all.indexOf(n))}" stroke-width="1.6" points="${pts
        .map((p) => `${xFor(p.t, t0, tN)},${yOf(p.d)}`)
        .join("L")}"/>`,
    );
  }
  svg.innerHTML =
    `<line class="grid" x1="${PL}" y1="${PT}" x2="${W - PR}" y2="${PT}"/>` +
    `<text x="4" y="${PT + 8}">Δ vs trunk</text>` +
    `<text x="${PL}" y="${h - 6}">${forkT}</text>` +
    `<text x="${W - PR - 20}" y="${h - 6}">${tN}</text>` +
    (min < 0 && max > 0 ? `<line class="zero" x1="${PL}" y1="${yOf(0)}" x2="${W - PR}" y2="${yOf(0)}"/>` : "") +
    lines.join("") +
    playheadMarkup(playheadT, t0, tN, h, forkT);

  const snap = branch.find((s) => s.t === playheadT);
  const bsnap = trunk.find((s) => s.t === playheadT);
  return all.map((n, i) => {
    const v = snap?.stocks[n];
    const bv = bsnap?.stocks[n];
    return { name: `Δ${n}`, color: colorOf(i), value: v !== undefined && bv !== undefined ? v - bv : 0 };
  });
}

export { fmtNum };
