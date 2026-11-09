import type { Snapshot } from "../../src/core/types.js";

export type ChartMode = "stacked" | "lines";

export interface LegendEntry {
  name: string;
  color: string;
  value: number;
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

function playheadMarkup(t: number, t0: number, tN: number, h: number): string {
  const x = xFor(t, t0, tN);
  return `<line class="playhead" x1="${x}" y1="${PT}" x2="${x}" y2="${h - PB}"/>`;
}

export function renderStocks(
  svg: SVGSVGElement,
  history: readonly Snapshot[],
  playheadT: number,
  mode: ChartMode,
  hidden: ReadonlySet<string>,
): LegendEntry[] {
  const h = 280;
  if (history.length === 0) {
    svg.innerHTML = "";
    return [];
  }
  const names = chartNames(history[0]).filter((n) => !hidden.has(n));
  const t0 = history[0].t;
  const tN = history[history.length - 1].t;
  const series = names.map((n) => history.map((s) => s.stocks[n] ?? 0));

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
    const yOf = (v: number) => PT + (1 - v / max) * (h - PT - PB);
    const base = history.map(() => 0);
    for (let j = 0; j < names.length; j++) {
      const color = colorOf(chartNames(history[0]).indexOf(names[j]));
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
    svg.innerHTML = grid(h, yOf, 0, max, t0, tN) + areas.join("") + playheadMarkup(playheadT, t0, tN, h);
  } else {
    min = Infinity;
    max = -Infinity;
    for (const vals of series) for (const v of vals) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) max = min + 1;
    const yOf = (v: number) => PT + (1 - (v - min) / (max - min)) * (h - PT - PB);
    for (let j = 0; j < names.length; j++) {
      const color = colorOf(chartNames(history[0]).indexOf(names[j]));
      const pts = history.map((s, i) => `${xFor(s.t, t0, tN)},${yOf(series[j][i])}`).join("L");
      areas.push(`<polyline fill="none" stroke="${color}" stroke-width="1.8" points="${pts}"/>`);
    }
    const zero = min < 0 && max > 0 ? `<line class="zero" x1="${PL}" y1="${yOf(0)}" x2="${W - PR}" y2="${yOf(0)}"/>` : "";
    svg.innerHTML = grid(h, yOf, min, max, t0, tN) + zero + areas.join("") + playheadMarkup(playheadT, t0, tN, h);
  }

  const snap = history.find((s) => s.t === playheadT) ?? history[0];
  return chartNames(history[0]).map((n, i) => ({ name: n, color: colorOf(i), value: snap.stocks[n] ?? 0 }));
}

export function renderDerived(
  svg: SVGSVGElement,
  history: readonly Snapshot[],
  playheadT: number,
  hidden: ReadonlySet<string>,
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
  const t0 = history[0].t;
  const tN = history[history.length - 1].t;
  const paths: string[] = [];
  if (visible.length > 0) {
    // Each derivation gets its own min/max: the pane is a shape probe (curves
    // that live on different scales can't share a y-axis meaningfully); the
    // legend shows the exact value at the playhead.
    visible.forEach((n) => {
      const vals = history.map((s) => s.derived[n] ?? 0);
      let min = Math.min(...vals);
      let max = Math.max(...vals);
      if (min === max) max = min + 1;
      const yOf = (v: number) => PT + (1 - (v - min) / (max - min)) * (h - PT - PB) + 4;
      const pts = history.map((s, i) => `${xFor(s.t, t0, tN)},${yOf(vals[i])}`).join("L");
      const color = colorOf(names.indexOf(n));
      paths.push(`<polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="5 3" points="${pts}"/>`);
    });
  }
  svg.innerHTML =
    `<line class="grid" x1="${PL}" y1="${PT}" x2="${W - PR}" y2="${PT}"/>` +
    `<text x="4" y="${PT + 8}">derived ~</text>` +
    `<text x="${W - PR - 20}" y="${h - 6}">${tN}</text>` +
    `<text x="${PL}" y="${h - 6}">${t0}</text>` +
    paths.join("") +
    playheadMarkup(playheadT, t0, tN, h);

  const snap = history.find((s) => s.t === playheadT) ?? history[0];
  return names.map((n, i) => ({ name: `~${n}`, color: colorOf(i), value: snap.derived[n] ?? 0 }));
}

export { fmtNum };
