import type { Snapshot } from "../core/types.js";

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

export function formatTable(history: readonly Snapshot[]): string {
  if (history.length === 0) return "";
  const names = stockNames(history);
  const header = ["t", ...names];
  const rows = history.map((s) => [
    String(s.t),
    ...names.map((n) => fmt(s.stocks[n] ?? 0)),
  ]);
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

export function formatCsv(history: readonly Snapshot[]): string {
  if (history.length === 0) return "";
  const names = stockNames(history);
  const rows = [
    ["t", ...names].join(","),
    ...history.map((s) =>
      [String(s.t), ...names.map((n) => String(s.stocks[n] ?? 0))].join(","),
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
