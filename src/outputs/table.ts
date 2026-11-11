import { snapAtOrBefore } from "../core/fold.js";
import { formatCalDate, tickAtOrBefore, tickToMs } from "../core/calendar.js";
import { DEFAULT_DAY_COUNT, daysPerTick } from "../core/units.js";
import type { MonteCarloResult } from "../core/mc.js";
import type { Branch, DayCount, Snapshot, TickUnit } from "../core/types.js";

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "") + fmt(n);
}

function stockNames(history: readonly Snapshot[]): string[] {
  const names = new Set<string>();
  for (const s of history) for (const k of Object.keys(s.stocks)) names.add(k);
  return [...names];
}

function derivedNames(history: readonly Snapshot[]): string[] {
  const names = new Set<string>();
  for (const s of history) for (const k of Object.keys(s.derived)) names.add(k);
  return [...names];
}

// The calendar overlay (milestone 7): a timeline whose snapshots carry a
// basis gets a civil-date column. A snapshot without one (a shared fork
// prefix from an undated trunk) prints a dash, matching the missing-stock
// convention rather than inventing an anchor.
const isDated = (history: readonly Snapshot[]): boolean =>
  history.some((s) => s.basis !== undefined);

const dateCell = (s: Snapshot): string =>
  s.basis === undefined
    ? "—"
    : formatCalDate(tickToMs(s.t, s.unit, s.basis, s.convention ?? DEFAULT_DAY_COUNT));

function aligned(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => {
    let width = h.length;
    for (const r of rows) if (r[i]!.length > width) width = r[i]!.length;
    return width;
  });
  const line = (cells: readonly string[]) =>
    cells.map((c, i) => c.padStart(widths[i]!)).join("  ");
  return [
    line(header),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...rows.map((r) => line(r)),
  ].join("\n");
}

export function formatTable(history: readonly Snapshot[]): string {
  if (history.length === 0) return "";
  const names = stockNames(history);
  const derived = derivedNames(history);
  const dated = isDated(history);
  const header = ["t", ...(dated ? ["date"] : []), ...names, ...derived.map((n) => `~${n}`)];
  // A fork variant can introduce stocks/derivations mid-run; the shared prefix
  // genuinely doesn't carry them, so print a dash rather than a fake 0.00.
  const cell = (v: number | undefined): string => (v === undefined ? "—" : fmt(v));
  const rows = history.map((s) => [
    String(s.t),
    ...(dated ? [dateCell(s)] : []),
    ...names.map((n) => cell(s.stocks[n])),
    ...derived.map((n) => cell(s.derived[n])),
  ]);
  return aligned(header, rows);
}

// Tick-by-tick what-if diff: branch minus trunk, only after the fork point
// (the shared prefix is diff-zero by construction). A "—" marks a stock the
// variant introduced, or a tick past the trunk's end, with nothing to
// subtract. Across a re-ticked fork the trunk is matched by duration (hold
// last), since branch ticks and trunk ticks no longer share a scale.
export function formatDiff(base: readonly Snapshot[], branch: Branch): string {
  if (branch.snapshots.length === 0) return "";
  const names = stockNames(branch.snapshots);
  const baseAt = new Map(base.map((s) => [s.t, s]));
  // Use the branch's horizon, not its first (possibly still trunk-shaped)
  // prefix snapshot: a re-based variant's new ticks denote different moments.
  const bh = branch.horizon;
  const crossUnit =
    base.length > 0 &&
    (bh.unit !== base[0]!.unit ||
      (bh.convention ?? DEFAULT_DAY_COUNT) !== (base[0]!.convention ?? DEFAULT_DAY_COUNT) ||
      bh.basis !== base[0]!.basis);
  const baseSnap = (s: Snapshot): Snapshot | undefined => {
    if (!crossUnit || base.length === 0) return baseAt.get(s.t);
    const b0 = base[0]!;
    const last = base[base.length - 1]!;
    // Dated timelines align by civil moment: a month/year tick's length is
    // leap-true, so the fixed day ratio would drift across February.
    if (s.basis !== undefined && b0.basis !== undefined) {
      const ms = tickToMs(s.t, s.unit, s.basis, s.convention ?? DEFAULT_DAY_COUNT);
      const lastMs = tickToMs(last.t, last.unit, last.basis ?? b0.basis, last.convention ?? DEFAULT_DAY_COUNT);
      if (ms > lastMs + 1e-6) return undefined;
      const eqTick = tickAtOrBefore(ms, b0.unit, b0.basis, b0.convention ?? DEFAULT_DAY_COUNT);
      // Don't clamp a moment before the trunk's first tick onto that snapshot.
      if (eqTick < b0.t) return undefined;
      return snapAtOrBefore(base, eqTick);
    }
    const ratio =
      daysPerTick(s.unit, s.convention ?? DEFAULT_DAY_COUNT) /
      daysPerTick(b0.unit, b0.convention ?? DEFAULT_DAY_COUNT);
    const eqTick = b0.t + (s.t - branch.snapshots[0]!.t) * ratio;
    if (eqTick > last.t + 1e-9) return undefined;
    return snapAtOrBefore(base, eqTick);
  };
  const after = branch.snapshots.filter((s) => s.t > (branch.forkTBranch ?? branch.forkT));
  if (after.length === 0) return "";
  const rows = after.map((s) => {
    const b = baseSnap(s);
    return [
      String(s.t),
      ...names.map((n) => {
        const v = s.stocks[n];
        const bv = b?.stocks[n];
        return v === undefined || bv === undefined ? "—" : fmtSigned(v - bv);
      }),
    ];
  });
  return aligned(["t", ...names.map((n) => `Δ${n}`)], rows);
}

// RFC 4180: quote fields containing commas, quotes, or line breaks, doubling
// embedded quotes. User-named stocks/derived values can contain any of these.
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsv(history: readonly Snapshot[]): string {
  if (history.length === 0) return "";
  const names = stockNames(history);
  const derived = derivedNames(history);
  const dated = isDated(history);
  // A fork variant can introduce stocks/derivations mid-run; the shared prefix
  // genuinely has no value for them. Emit an empty field rather than a fake 0,
  // matching formatTable's dash (and keeping real zeros distinguishable).
  const cell = (v: number | undefined): string => (v === undefined ? "" : String(v));
  const rows = [
    ["t", ...(dated ? ["date"] : []), ...names, ...derived].map(csvField).join(","),
    ...history.map((s) =>
      [
        String(s.t),
        ...(dated ? [s.basis === undefined ? "" : dateCell(s)] : []),
        ...names.map((n) => cell(s.stocks[n])),
        ...derived.map((n) => cell(s.derived[n])),
      ].join(","),
    ),
  ];
  return rows.join("\n");
}

export function formatFlows(history: readonly Snapshot[]): string {
  const lines: string[] = [];
  for (const s of history) {
    if (s.deltas.length === 0) continue;
    lines.push(`t=${s.t}`);
    for (const d of s.deltas) {
      const where = d.loc
        ? `  @${d.loc.file}:${d.loc.line}:${d.loc.column}`
        : "";
      lines.push(
        `  ${fmtSigned(d.amount).padStart(14)}  ${d.stock.padEnd(12)} ${d.rule}${where}`,
      );
    }
  }
  return lines.join("\n");
}

// ---- Monte Carlo percentiles (milestone 8) -------------------------------
// Collapse N immutable path timelines into one percentile timeline: the
// print/visual analog of the stacked chart. Every paths share the fold's
// tick grid, so aggregation is positional; stocks/derived are unioned the
// same defensive way the plain table unions them across fork variants.

export const DEFAULT_PERCENTILES: readonly number[] = [10, 50, 90];

export interface PercentileRow {
  readonly t: number;
  readonly unit: TickUnit;
  readonly convention?: DayCount | undefined;
  readonly basis?: number | undefined;
  readonly count: number;
  readonly stocks: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly derived: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface PercentileSummary {
  readonly seed: number;
  readonly paths: number;
  readonly percentiles: readonly number[];
  readonly labels: readonly string[];
  readonly rows: readonly PercentileRow[];
}

export const percentileLabel = (p: number): string => `p${p}`;

// Linear interpolation between the two closest ranks (the R-7 / NumPy
// default) — deterministic and stable on ties.
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty sample");
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function summarizeMonteCarlo(
  mc: MonteCarloResult,
  percentiles: readonly number[] = DEFAULT_PERCENTILES,
): PercentileSummary {
  if (mc.timelines.length === 0) throw new Error("summarizeMonteCarlo requires at least one path");
  if (percentiles.length === 0) throw new Error("summarizeMonteCarlo requires at least one percentile");
  for (const p of percentiles) {
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new Error(`percentile must be within 0..100 (got ${p})`);
    }
  }
  const n = mc.timelines[0]!.length;
  if (n === 0) throw new Error("Monte Carlo timelines are empty");
  const t0 = mc.timelines[0]![0]!.t;
  for (const [i, hist] of mc.timelines.entries()) {
    if (hist.length !== n) {
      throw new Error(`path ${i} has ${hist.length} snapshots, path 0 has ${n} — timelines must share the tick grid`);
    }
    if (hist[0]!.t !== t0) {
      throw new Error(`path ${i} starts at t=${hist[0]!.t}, path 0 at t=${t0} — timelines must share the tick grid`);
    }
  }
  const labels = percentiles.map(percentileLabel);
  const namesOf = (key: "stocks" | "derived") => {
    const names = new Set<string>();
    for (const hist of mc.timelines) for (const s of hist) for (const k of Object.keys(s[key])) names.add(k);
    return [...names];
  };
  const stockNames = namesOf("stocks");
  const derivedNames = namesOf("derived");

  const perName = (key: "stocks" | "derived", names: readonly string[], i: number) => {
    const out: Record<string, Record<string, number>> = {};
    for (const name of names) {
      const values: number[] = [];
      for (const hist of mc.timelines) {
        const v = hist[i]![key][name];
        if (v !== undefined) values.push(v);
      }
      if (values.length === 0) continue;
      values.sort((a, b) => a - b);
      const row: Record<string, number> = {};
      for (const [j, p] of percentiles.entries()) row[labels[j]!] = percentile(values, p);
      out[name] = row;
    }
    return out;
  };

  const rows: PercentileRow[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = mc.timelines[0]![i]!;
    rows.push(
      Object.freeze({
        t: s0.t,
        unit: s0.unit,
        ...(s0.convention === undefined ? {} : { convention: s0.convention }),
        ...(s0.basis === undefined ? {} : { basis: s0.basis }),
        count: mc.timelines.length,
        stocks: Object.freeze(perName("stocks", stockNames, i)),
        derived: Object.freeze(perName("derived", derivedNames, i)),
      }),
    );
  }
  return Object.freeze({
    seed: mc.seed,
    paths: mc.paths,
    percentiles: Object.freeze([...percentiles]),
    labels: Object.freeze(labels),
    rows: Object.freeze(rows),
  });
}

const percentileCell = (
  sample: Readonly<Record<string, number>> | undefined,
  labels: readonly string[],
  fmt: (n: number) => string,
): string[] => labels.map((l) => (sample && l in sample ? fmt(sample[l]!) : "—"));

// One column per stock × percentile (netWorth·p10, netWorth·p50, …). The
// middle-dot separator keeps user names readable even when they contain
// commas or spaces; CSV quoting covers the rest.
export function formatPercentileTable(summary: PercentileSummary): string {
  if (summary.rows.length === 0) return "";
  const stockNames = new Set<string>();
  const derivedNames = new Set<string>();
  for (const r of summary.rows) {
    for (const k of Object.keys(r.stocks)) stockNames.add(k);
    for (const k of Object.keys(r.derived)) derivedNames.add(k);
  }
  const dated = summary.rows.some((r) => r.basis !== undefined);
  const header = [
    "t",
    ...(dated ? ["date"] : []),
    ...[...stockNames].flatMap((n) => summary.labels.map((l) => `${n}·${l}`)),
    ...[...derivedNames].flatMap((n) => summary.labels.map((l) => `~${n}·${l}`)),
  ];
  const dateOf = (r: PercentileRow): string =>
    r.basis === undefined
      ? "—"
      : formatCalDate(tickToMs(r.t, r.unit, r.basis, r.convention ?? DEFAULT_DAY_COUNT));
  const rows = summary.rows.map((r) => [
    String(r.t),
    ...(dated ? [dateOf(r)] : []),
    ...[...stockNames].flatMap((n) => percentileCell(r.stocks[n], summary.labels, fmt)),
    ...[...derivedNames].flatMap((n) => percentileCell(r.derived[n], summary.labels, fmt)),
  ]);
  return aligned(header, rows);
}

export function formatPercentileCsv(summary: PercentileSummary): string {
  if (summary.rows.length === 0) return "";
  const stockNames = new Set<string>();
  const derivedNames = new Set<string>();
  for (const r of summary.rows) {
    for (const k of Object.keys(r.stocks)) stockNames.add(k);
    for (const k of Object.keys(r.derived)) derivedNames.add(k);
  }
  const dated = summary.rows.some((r) => r.basis !== undefined);
  const cell = (sample: Readonly<Record<string, number>> | undefined, l: string): string =>
    sample && l in sample ? String(sample[l]) : "";
  const header = [
    "t",
    ...(dated ? ["date"] : []),
    ...[...stockNames].flatMap((n) => summary.labels.map((l) => `${n}·${l}`)),
    ...[...derivedNames].flatMap((n) => summary.labels.map((l) => `~${n}·${l}`)),
  ].map(csvField);
  const rows = summary.rows.map((r) =>
    [
      String(r.t),
      ...(dated ? [r.basis === undefined ? "" : formatCalDate(tickToMs(r.t, r.unit, r.basis, r.convention ?? DEFAULT_DAY_COUNT))] : []),
      ...[...stockNames].flatMap((n) => summary.labels.map((l) => cell(r.stocks[n], l))),
      ...[...derivedNames].flatMap((n) => summary.labels.map((l) => cell(r.derived[n], l))),
    ].join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
