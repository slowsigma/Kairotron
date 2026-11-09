import type { Snapshot } from "../../src/core/types.js";
import { fmtNum } from "./chart.js";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    `<h4>t = ${snap.t} (${tickUnit} ticks)</h4>` +
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
