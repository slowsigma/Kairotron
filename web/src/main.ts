import { run } from "../../src/core/fold.js";
import type { Horizon, Model, Rule, Snapshot } from "../../src/core/types.js";
import { formatCsv, formatTable } from "../../src/outputs/table.js";
import {
  colorOf,
  fmtNum,
  renderDerived,
  renderStocks,
  tickAt,
  type ChartMode,
} from "./chart.js";
import { Editor } from "./editor.js";
import { renderInspector } from "./inspector.js";
import { compileModel, horizonOverride, userLine, type Compiled } from "./repl.js";
import { SAMPLE } from "./sample.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const editor = new Editor($("editor"), SAMPLE);
const stocksSvg = $("stocks-chart") as unknown as SVGSVGElement;
const derivedSvg = $("derived-chart") as unknown as SVGSVGElement;
const slider = $("slider") as unknown as HTMLInputElement;
const statusEl = $("status");
const tabBody = $("tab-body");

interface AppState {
  history: readonly Snapshot[];
  horizon: Horizon;
  playhead: number;
  hidden: Set<string>;
  ruleLines: Map<string, number[]>;
  tab: "inspector" | "table";
  mode: ChartMode;
  hoverRule: string | undefined;
}

const state: AppState = {
  history: [],
  horizon: { start: 0, end: 40, unit: "year" },
  playhead: 0,
  hidden: new Set(),
  ruleLines: new Map(),
  tab: "inspector",
  mode: "stacked",
  hoverRule: undefined,
};

function collectRuleLines(model: Model, compiled: Compiled): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const walk = (rule: Rule): void => {
    const line = userLine(rule.loc, compiled);
    if ("label" in rule && typeof rule.label === "string" && line !== undefined) {
      map.set(rule.label, [...(map.get(rule.label) ?? []), line]);
    }
    if (rule.kind === "when" || rule.kind === "unless" || rule.kind === "on") walk(rule.rule);
  };
  for (const r of model.rules) walk(r);
  return map;
}

function stockColors(): Map<string, string> {
  const colors = new Map<string, string>();
  if (state.history.length > 0) {
    Object.keys(state.history[0].stocks).forEach((n, i) => colors.set(n, colorOf(i)));
  }
  return colors;
}

function highlightLines(): Set<number> {
  const snap = currentSnap();
  const lines = new Set<number>();
  const collect = (rule: string): void => {
    for (const l of state.ruleLines.get(rule) ?? []) lines.add(l);
  };
  if (snap) for (const d of snap.deltas) collect(d.rule);
  if (state.hoverRule) collect(state.hoverRule);
  return lines;
}

function currentSnap(): Snapshot | undefined {
  return state.history.find((s) => s.t === state.playhead) ?? state.history[0];
}

function renderView(): void {
  if (state.history.length === 0) return;
  const stocks = renderStocks(stocksSvg, state.history, state.playhead, state.mode, state.hidden);
  const derived = renderDerived(derivedSvg, state.history, state.playhead, state.hidden);
  renderLegend($("stocks-legend"), stocks);
  renderLegend($("derived-legend"), derived);
  $("playhead-label").textContent =
    `t=${state.playhead} · ${state.horizon.unit}` +
    (currentSnap() ? ` · ${stockValues()}` : "");
  editor.setHighlights(highlightLines());

  if (state.tab === "inspector") {
    const snap = currentSnap();
    if (snap) {
      renderInspector(tabBody, snap, stockColors(), state.horizon.unit, (rule) => {
        state.hoverRule = rule;
        editor.setHighlights(highlightLines());
      });
    }
  } else {
    if (!tabBody.querySelector("pre")) {
      tabBody.innerHTML = `<pre class="raw">${escapeHtml(formatTable(state.history))}</pre>`;
    }
  }
}

function stockValues(): string {
  const snap = currentSnap();
  if (!snap) return "";
  return Object.entries(snap.stocks)
    .map(([n, v]) => `${n}=${fmtNum(v)}`)
    .join("  ");
}

function renderLegend(root: HTMLElement, entries: { name: string; color: string; value: number }[]): void {
  root.innerHTML = entries
    .map(
      (e) =>
        `<span class="item${state.hidden.has(e.name.replace(/^~/, "")) ? " off" : ""}" data-name="${e.name}">` +
        `<span class="swatch" style="background:${e.color}"></span>${e.name} <span class="val">${fmtNum(e.value)}</span></span>`,
    )
    .join("");
  root.querySelectorAll<HTMLElement>(".item").forEach((el) => {
    el.addEventListener("click", () => {
      const name = (el.dataset.name as string).replace(/^~/, "");
      if (state.hidden.has(name)) state.hidden.delete(name);
      else state.hidden.add(name);
      renderView();
    });
  });
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", isError);
}

function setPlayhead(t: number): void {
  if (state.history.length === 0) return;
  const t0 = state.history[0].t;
  const tN = state.history[state.history.length - 1].t;
  state.playhead = Math.min(tN, Math.max(t0, t));
  slider.value = String(state.playhead - t0);
  state.hoverRule = undefined;
  renderView();
}

function runNow(): void {
  const code = editor.text;
  try {
    const compiled = compileModel(code);
    const base = compiled.model.horizon;
    const override = horizonOverride(
      ($("h-start") as unknown as HTMLInputElement).value,
      ($("h-end") as unknown as HTMLInputElement).value,
      ($("h-unit") as unknown as HTMLSelectElement).value,
      base,
    );
    const t = performance.now();
    const history = run(compiled.model, override);
    const ms = performance.now() - t;
    state.history = history;
    state.horizon = override ?? base;
    state.ruleLines = collectRuleLines(compiled.model, compiled);
    state.hidden = new Set([...state.hidden].filter((n) => n in history[0].stocks || n in history[0].derived));
    state.playhead = state.history[0].t;
    slider.min = "0";
    slider.max = String(history.length - 1);
    tabBody.innerHTML = "";
    setStatus(`ok — ${history.length - 1} ticks · ${ms.toFixed(1)}ms`);
    setPlayhead(state.playhead);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

$("run").addEventListener("click", runNow);
editor.onRun(runNow);

slider.addEventListener("input", () => {
  if (state.history.length === 0) return;
  setPlayhead(state.history[0].t + Number(slider.value));
});

const attachScrub = (svg: SVGSVGElement): void => {
  let dragging = false;
  const toT = (e: PointerEvent) =>
    tickAt(svg, e.clientX, state.history[0].t, state.history[state.history.length - 1].t);
  svg.addEventListener("pointerdown", (e) => {
    if (state.history.length === 0) return;
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    setPlayhead(toT(e));
  });
  svg.addEventListener("pointermove", (e) => {
    if (dragging) setPlayhead(toT(e));
  });
  svg.addEventListener("pointerup", () => {
    dragging = false;
  });
};
attachScrub(stocksSvg);
attachScrub(derivedSvg);

$("h-unit").addEventListener("change", (e) => {
  if (state.history.length) runNow();
  void e;
});

$("chart-mode").addEventListener("change", (e) => {
  state.mode = ($("chart-mode") as unknown as HTMLSelectElement).value as ChartMode;
  void e;
  renderView();
});

document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tab = btn.dataset.tab as AppState["tab"];
    tabBody.innerHTML = "";
    renderView();
  });
});

$("exp-csv").addEventListener("click", () => {
  if (state.history.length) download("kairotron.csv", formatCsv(state.history), "text/csv");
});
$("exp-json").addEventListener("click", () => {
  if (state.history.length) {
    download("kairotron.json", JSON.stringify({ horizon: state.horizon, history: state.history }, null, 2), "application/json");
  }
});

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft") setPlayhead(state.playhead - 1);
  if (e.key === "ArrowRight") setPlayhead(state.playhead + 1);
});

runNow();
