import { fork, run } from "../../src/core/fold.js";
import type { Horizon, Model, Rule, Snapshot } from "../../src/core/types.js";
import { formatCsv, formatTable } from "../../src/outputs/table.js";
import {
  colorOf,
  fmtNum,
  renderDerived,
  renderDiff,
  renderStocks,
  stockNamesOf,
  tickAt,
  visibleSpan,
  type ChartMode,
  type Ghost,
} from "./chart.js";
import { Editor } from "./editor.js";
import { renderInspector } from "./inspector.js";
import { compileModel, horizonOverride, userLine, type Compiled } from "./repl.js";
import { SAMPLE } from "./sample.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const editor = new Editor($("editor"), SAMPLE);
const stocksSvg = $("stocks-chart") as unknown as SVGSVGElement;
const derivedSvg = $("derived-chart") as unknown as SVGSVGElement;
const diffSvg = $("diff-chart") as unknown as SVGSVGElement;
const slider = $("slider") as unknown as HTMLInputElement;
const statusEl = $("status");
const tabBody = $("tab-body");

// One entry per timeline. The trunk (id 0) is the plain run; branches fork
// from it at a snapshot and continue with their own model code. States are
// immutable, so the shared prefix costs nothing and re-forking after a trunk
// edit is a fold, not a merge.
interface BranchRec {
  readonly id: number;
  readonly label: string;
  readonly forkT?: number; // undefined only for the trunk
  code: string;            // editor buffer, kept per branch
  model?: Model;           // last successfully run model (for trunk-refork)
  history: readonly Snapshot[];
  horizon: Horizon;
  ruleLines: Map<string, number[]>;
}

interface AppState {
  branches: BranchRec[];
  active: number;
  playhead: number;
  hidden: Set<string>;
  tab: "inspector" | "table";
  mode: ChartMode;
  hoverRule: string | undefined;
}

const state: AppState = {
  branches: [
    {
      id: 0,
      label: "main",
      code: SAMPLE,
      history: [],
      horizon: { start: 0, end: 40, unit: "year" },
      ruleLines: new Map(),
    },
  ],
  active: 0,
  playhead: 0,
  hidden: new Set(),
  tab: "inspector",
  mode: "stacked",
  hoverRule: undefined,
};

let nextBranchId = 1;

const cur = (): BranchRec => state.branches[state.active]!;
const trunk = (): BranchRec => state.branches[0]!;

function ghostOf(): Ghost | undefined {
  const c = cur();
  if (c.forkT === undefined || trunk().history.length === 0) return undefined;
  return { snapshots: trunk().history, forkT: c.forkT };
}

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
  stockNamesOf(cur().history).forEach((n, i) => colors.set(n, colorOf(i)));
  return colors;
}

function highlightLines(): Set<number> {
  const snap = currentSnap();
  const lines = new Set<number>();
  const collect = (rule: string): void => {
    for (const l of cur().ruleLines.get(rule) ?? []) lines.add(l);
  };
  if (snap) for (const d of snap.deltas) collect(d.rule);
  if (state.hoverRule) collect(state.hoverRule);
  return lines;
}

function currentSnap(): Snapshot | undefined {
  const h = cur().history;
  return h.find((s) => s.t === state.playhead) ?? h[0];
}

function renderView(): void {
  const c = cur();
  if (c.history.length === 0) return;
  const ghost = ghostOf();
  const stocks = renderStocks(stocksSvg, c.history, state.playhead, state.mode, state.hidden, ghost);
  const derived = renderDerived(derivedSvg, c.history, state.playhead, state.hidden, ghost);
  const diffPane = $("diff-pane");
  if (c.forkT !== undefined && trunk().history.length > 0) {
    diffPane.hidden = false;
    renderLegend($("diff-legend"), renderDiff(diffSvg, trunk().history, c.history, c.forkT, state.playhead, state.hidden));
  } else {
    diffPane.hidden = true;
    diffSvg.innerHTML = "";
  }
  renderLegend($("stocks-legend"), stocks);
  renderLegend($("derived-legend"), derived);
  $("playhead-label").textContent =
    `t=${state.playhead} · ${c.horizon.unit}` +
    (currentSnap() ? ` · ${stockValues()}` : "");
  editor.setHighlights(highlightLines());

  if (state.tab === "inspector") {
    const snap = currentSnap();
    if (snap) {
      renderInspector(tabBody, snap, stockColors(), c.horizon.unit, (rule) => {
        state.hoverRule = rule;
        editor.setHighlights(highlightLines());
      });
    }
  } else {
    if (!tabBody.querySelector("pre")) {
      tabBody.innerHTML = `<pre class="raw">${escapeHtml(formatTable(c.history))}</pre>`;
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
  // Stock names are arbitrary user strings and become attribute values here,
  // so escape them including quotes (an unescaped `"` injects attributes).
  root.innerHTML = entries
    .map(
      (e) =>
        `<span class="item${state.hidden.has(e.name.replace(/^~/, "").replace(/^Δ/, "")) ? " off" : ""}" data-name="${escapeHtml(e.name)}">` +
        `<span class="swatch" style="background:${e.color}"></span>${escapeHtml(e.name)} <span class="val">${fmtNum(e.value)}</span></span>`,
    )
    .join("");
  root.querySelectorAll<HTMLElement>(".item").forEach((el) => {
    el.addEventListener("click", () => {
      const name = (el.dataset.name as string).replace(/^~/, "").replace(/^Δ/, "");
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
  const h = cur().history;
  if (h.length === 0) return;
  const t0 = h[0].t;
  const tN = h[h.length - 1].t;
  state.playhead = Math.min(tN, Math.max(t0, t));
  slider.max = String(tN - t0);
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
    const horizon = override ?? base;
    const c = cur();
    const t = performance.now();
    let status: string;
    if (c.forkT === undefined) {
      const history = run(compiled.model, override);
      const ms = performance.now() - t;
      c.code = code;
      c.model = compiled.model;
      c.history = history;
      c.horizon = horizon;
      c.ruleLines = collectRuleLines(compiled.model, compiled);
      // Branches ride out trunk edits: re-fork them from the new trunk at
      // their original tick. Forks whose tick fell out of the new horizon or
      // whose tick unit no longer matches are dropped.
      const dropped: string[] = [];
      let reforked = 0;
      for (const b of state.branches) {
        if (b.forkT === undefined) continue;
        if (!b.model) {
          const idx = history.findIndex((s) => s.t === b.forkT);
          if (idx === -1) dropped.push(b.label);
          else b.history = history.slice(0, idx + 1);
          continue;
        }
        try {
          if (b.horizon.unit !== horizon.unit) throw new Error("tick unit changed");
          b.history = fork(history, b.forkT, b.model, { label: b.label, horizon: b.horizon }).snapshots;
          reforked++;
        } catch {
          dropped.push(b.label);
        }
      }
      if (dropped.length) state.branches = state.branches.filter((b) => !dropped.includes(b.label));
      if (!state.branches.includes(c)) {
        state.active = 0;
        editor.text = cur().code;
      }
      renderBranchBar();
      const forkNote =
        reforked ? ` · reforked ${reforked}` : dropped.length ? ` · dropped ${dropped.join(", ")}` : "";
      status = `ok — ${history.length - 1} ticks · ${ms.toFixed(1)}ms${forkNote}`;
    } else {
      if (trunk().history.length === 0) throw new Error("branches need the trunk — run main first");
      if (horizon.unit !== trunk().horizon.unit) {
        throw new Error("can't change the tick unit across a fork yet (that's milestone 6)");
      }
      const b = fork(trunk().history, c.forkT, compiled.model, { label: c.label, horizon });
      const ms = performance.now() - t;
      c.code = code;
      c.model = compiled.model;
      c.history = b.snapshots;
      c.horizon = b.horizon;
      c.ruleLines = collectRuleLines(compiled.model, compiled);
      status = `${c.label} · ok — ${b.snapshots.length - 1} ticks · ${ms.toFixed(1)}ms · forked @t=${c.forkT}`;
    }
    const c2 = cur();
    state.hidden = new Set([...state.hidden].filter((n) => n in c2.history[0].stocks || n in c2.history[0].derived));
    tabBody.innerHTML = "";
    setStatus(status);
    setPlayhead(state.playhead);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

function forkHere(): void {
  const c = cur();
  if (c.history.length === 0) return;
  const th = trunk().history;
  const t = state.playhead;
  const idx = th.findIndex((s) => s.t === t);
  if (idx === -1) {
    setStatus(`cannot fork at t=${t}: outside the trunk (${th[0].t}..${th[th.length - 1].t})`, true);
    return;
  }
  c.code = editor.text;
  const rec: BranchRec = {
    id: nextBranchId,
    label: `b${nextBranchId}`,
    forkT: t,
    code: c.code,
    history: th.slice(0, idx + 1),
    horizon: trunk().horizon,
    ruleLines: c.ruleLines,
  };
  nextBranchId++;
  state.branches.push(rec);
  state.active = state.branches.length - 1;
  tabBody.innerHTML = "";
  renderBranchBar();
  setPlayhead(t);
  setStatus(`branch ${rec.label} forked at t=${t} — edit the model & Run to diverge`);
}

function renderBranchBar(): void {
  const bar = $("branchbar");
  bar.hidden = state.branches.length < 2;
  bar.innerHTML =
    "<span>branches</span>" +
    state.branches
      .map((b, i) => {
        const label = b.forkT === undefined ? b.label : `${b.label}@${b.forkT}`;
        const kill = b.forkT === undefined ? "" : `<span class="x" data-kill="${b.id}" title="discard branch">×</span>`;
        return `<span class="chip${i === state.active ? " active" : ""}" data-id="${b.id}" data-label="${b.label}">${label}${kill}</span>`;
      })
      .join("");
  bar.querySelectorAll<HTMLElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      const kill = (e.target as HTMLElement).dataset.kill;
      if (kill !== undefined) {
        discardBranch(Number(kill));
        return;
      }
      activate(Number(chip.dataset.id));
    });
  });
}

function activate(id: number): void {
  const idx = state.branches.findIndex((b) => b.id === id);
  if (idx === -1 || idx === state.active) return;
  cur().code = editor.text;
  state.active = idx;
  editor.text = cur().code;
  tabBody.innerHTML = "";
  renderBranchBar();
  setPlayhead(state.playhead);
}

function discardBranch(id: number): void {
  const idx = state.branches.findIndex((b) => b.id === id);
  if (idx <= 0) return; // the trunk is not discardable
  const wasActive = idx === state.active;
  state.branches.splice(idx, 1);
  if (wasActive) {
    state.active = Math.min(idx, state.branches.length - 1);
    editor.text = cur().code;
  } else if (idx < state.active) {
    // Removing an earlier chip shifts every later index down one.
    state.active -= 1;
  }
  tabBody.innerHTML = "";
  renderBranchBar();
  setPlayhead(state.playhead);
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

$("run").addEventListener("click", runNow);
$("fork").addEventListener("click", forkHere);
editor.onRun(runNow);

slider.addEventListener("input", () => {
  if (cur().history.length === 0) return;
  setPlayhead(cur().history[0].t + Number(slider.value));
});

const attachScrub = (svg: SVGSVGElement): void => {
  let dragging = false;
  const toT = (e: PointerEvent) => {
    const { t0, tN } = visibleSpan(cur().history, ghostOf());
    return tickAt(svg, e.clientX, t0, tN);
  };
  svg.addEventListener("pointerdown", (e) => {
    if (cur().history.length === 0) return;
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

$("h-unit").addEventListener("change", () => {
  if (cur().history.length) runNow();
});

$("chart-mode").addEventListener("change", () => {
  state.mode = ($("chart-mode") as unknown as HTMLSelectElement).value as ChartMode;
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
  if (cur().history.length) download("kairotron.csv", formatCsv(cur().history), "text/csv");
});
$("exp-json").addEventListener("click", () => {
  const c = cur();
  if (c.history.length) {
    download(
      "kairotron.json",
      JSON.stringify({ branch: c.label, forkT: c.forkT, horizon: c.horizon, history: c.history }, null, 2),
      "application/json",
    );
  }
});

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft") setPlayhead(state.playhead - 1);
  if (e.key === "ArrowRight") setPlayhead(state.playhead + 1);
});

runNow();
