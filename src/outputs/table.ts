import type { Branch, Snapshot } from "../core/types.js";

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

function aligned(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
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
  const header = ["t", ...names, ...derived.map((n) => `~${n}`)];
  // A fork variant can introduce stocks/derivations mid-run; the shared prefix
  // genuinely doesn't carry them, so print a dash rather than a fake 0.00.
  const cell = (v: number | undefined): string => (v === undefined ? "—" : fmt(v));
  const rows = history.map((s) => [
    String(s.t),
    ...names.map((n) => cell(s.stocks[n])),
    ...derived.map((n) => cell(s.derived[n])),
  ]);
  return aligned(header, rows);
}

// Tick-by-tick what-if diff: branch minus trunk, only after the fork point
// (the shared prefix is diff-zero by construction). A "—" marks a stock the
// variant introduced, or a tick past the trunk's end, with nothing to
// subtract.
export function formatDiff(base: readonly Snapshot[], branch: Branch): string {
  if (branch.snapshots.length === 0) return "";
  const names = stockNames(branch.snapshots);
  const baseAt = new Map(base.map((s) => [s.t, s]));
  const after = branch.snapshots.filter((s) => s.t > branch.forkT);
  if (after.length === 0) return "";
  const rows = after.map((s) => {
    const b = baseAt.get(s.t);
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
  const rows = [
    ["t", ...names, ...derived].map(csvField).join(","),
    ...history.map((s) =>
      [
        String(s.t),
        ...names.map((n) => String(s.stocks[n] ?? 0)),
        ...derived.map((n) => String(s.derived[n] ?? 0)),
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
