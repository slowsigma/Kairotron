import { formatCalDate, tickToMs } from "../../src/core/calendar.js";
import { DEFAULT_DAY_COUNT } from "../../src/core/units.js";
import type { PercentileRow } from "../../src/outputs/table.js";
import type { Snapshot } from "../../src/core/types.js";
import { fmtNum } from "./chart.js";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Calendar overlay: an undated timeline shows ticks only; a dated one adds
// the civil moment of the snapshot.
const whenLabel = (snap: Snapshot): string =>
  snap.basis === undefined
    ? ""
    : ` · ${formatCalDate(tickToMs(snap.t, snap.unit, snap.basis, snap.convention ?? DEFAULT_DAY_COUNT))}`;

export function renderInspector(
  root: HTMLElement,
  snap: Snapshot,
  colors: ReadonlyMap<string, string>,
  tickUnit: string,
  onHoverRule: (rule: string) => void,
): void {
  const stockRows = Object.entries(snap.stocks)
    .map(
      ([name, v]) =>
        `<tr><td><span class="sw" style="background:${colors.get(name) ?? "#666"}"></span>${escapeHtml(name)}</td><td>${fmtNum(v)}</td></tr>`,
    )
    .join("");
  const derivedRows = Object.entries(snap.derived)
    .map(
      ([name, v]) =>
        `<tr><td>~${escapeHtml(name)}</td><td>${fmtNum(v, 4)}</td></tr>`,
    )
    .join("");
  const deltaRows = snap.deltas
    .map((d) => {
      const cls = d.amount < 0 ? "neg" : "pos";
      return `<tr class="delta" data-rule="${escapeHtml(d.rule)}" title="highlight this rule"><td>${escapeHtml(d.rule)}</td><td>${escapeHtml(d.stock)}</td><td class="${cls}">${d.amount >= 0 ? "+" : ""}${fmtNum(d.amount)}</td></tr>`;
    })
    .join("");

  root.innerHTML =
    `<h4>t = ${snap.t} (${tickUnit} ticks)${whenLabel(snap)}</h4>` +
    `<table class="insp">${stockRows}</table>` +
    (derivedRows ? `<h4>derived</h4><table class="insp">${derivedRows}</table>` : "") +
    `<h4>this tick's deltas (${snap.deltas.length})</h4>` +
    (deltaRows
      ? `<table class="insp"><tr><th>rule</th><th>stock</th><th>amount</th></tr>${deltaRows}</table>`
      : `<div style="color:var(--dim)">nothing moved at this tick</div>`);

  root.querySelectorAll<HTMLTableRowElement>("tr.delta").forEach((tr) => {
    const rule = tr.dataset.rule as string;
    tr.addEventListener("mouseenter", () => onHoverRule(rule));
    tr.addEventListener("click", () => onHoverRule(rule));
  });
}

// Monte Carlo mode (milestone 8): the state vector at the playhead is a
// distribution, not a point — one row per stock, one column per percentile.
// Deltas have no meaning across paths, so they are replaced by the run's
// seed identity (same seed, same paths).
export function renderPercentileInspector(
  root: HTMLElement,
  row: PercentileRow,
  colors: ReadonlyMap<string, string>,
  tickUnit: string,
  labels: readonly string[],
  paths: number,
  seed: number,
): void {
  const head = `<tr><th></th>${labels.map((l) => `<th>${escapeHtml(l)}</th>`).join("")}</tr>`;
  const when =
    row.basis === undefined
      ? ""
      : ` · ${formatCalDate(tickToMs(row.t, row.unit, row.basis, row.convention ?? DEFAULT_DAY_COUNT))}`;
  const table = (
    samples: Readonly<Record<string, Readonly<Record<string, number>>>>,
    decorate: (name: string) => string,
    digits: number,
  ): string =>
    Object.entries(samples)
      .map(
        ([name, values]) =>
          `<tr><td>${decorate(name)}</td>${labels
            .map((l) => `<td>${values[l] === undefined ? "—" : fmtNum(values[l]!, digits)}</td>`)
            .join("")}</tr>`,
      )
      .join("");
  const stockRows = table(
    row.stocks,
    (name) =>
      `<span class="sw" style="background:${colors.get(name) ?? "#666"}"></span>${escapeHtml(name)}`,
    2,
  );
  const derivedRows = table(row.derived, (name) => `~${escapeHtml(name)}`, 4);
  root.innerHTML =
    `<h4>t = ${row.t} (${tickUnit} ticks)${when}</h4>` +
    `<div style="color:var(--dim)">Monte Carlo · ${paths} paths · seed ${seed}</div>` +
    `<table class="insp">${head}${stockRows}</table>` +
    (derivedRows ? `<h4>derived</h4><table class="insp">${head}${derivedRows}</table>` : "");
}
