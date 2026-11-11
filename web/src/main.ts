import { fork, run, snapAtOrBefore } from "../../src/core/fold.js";
import { formatCalDate, tickAtOrBefore, tickToMs } from "../../src/core/calendar.js";
import { DEFAULT_MC_SEED, forkMonteCarlo, type MonteCarloResult } from "../../src/core/mc.js";
import type { Horizon, Model, Rule, Snapshot } from "../../src/core/types.js";
import { DEFAULT_DAY_COUNT, daysPerTick } from "../../src/core/units.js";
import {
  formatCsv,
  formatPercentileCsv,
  formatPercentileTable,
  formatTable,
  summarizeMonteCarlo,
  type PercentileRow,
  type PercentileSummary,
} from "../../src/outputs/table.js";
import {
  colorOf,
  fmtNum,
  renderBands,
  renderDerived,
  renderDiff,
  renderStocks,
  stockNamesOf,
  tickAt,
  visibleSpan,
  type ChartMode,
  type Ghost,
  type XLabel,
} from "./chart.js";
import { Editor } from "./editor.js";
import { renderInspector, renderPercentileInspector } from "./inspector.js";
import { runPathsPool } from "./mc-pool.js";
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
  // Monte Carlo (milestone 8): the raw path set (for same-world forks) and
  // its percentile summary (for the band view). The deterministic run stays
  // in `history` — it is the expected-value baseline the bands sit on.
  mc?: MonteCarloResult | undefined;
  summary?: PercentileSummary | undefined;
}

// Chart bands need a level in from both edges, hence five quantiles.
const MC_UI_PERCENTILES = [10, 25, 50, 75, 90];

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

// The trunk ghost and the Δ pane overlay the branch on the trunk's tick scale,
// so both require the same unit, day-count convention, and tick-0 basis. A
// re-ticked or re-based branch is diffed in the CLI (formatDiff aligns by
// moment), not overlaid here.
function sameScale(): boolean {
  const c = cur();
  const th = trunk();
  return (
    th.history.length > 0 &&
    c.history.length > 0 &&
    th.horizon.unit === c.horizon.unit &&
    (th.horizon.convention ?? DEFAULT_DAY_COUNT) === (c.horizon.convention ?? DEFAULT_DAY_COUNT) &&
    th.horizon.basis === c.horizon.basis
  );
}

function ghostOf(): Ghost | undefined {
  const c = cur();
  if (c.forkT === undefined || !sameScale()) return undefined;
  return { snapshots: trunk().history, forkT: c.forkT };
}

function diffable(): boolean {
  const c = cur();
  return c.forkT !== undefined && sameScale();
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

// Calendar axis: the timeline's snapshots carry the basis; ticks render as
// civil dates instead of bare numbers (plan.md's c.when(t) / c.date(t)).
// Use the snapshot in force at each tick — a branch may carry the trunk's
// basis through its shared prefix and its variant's own basis on new ticks.
function xLabelFor(c: BranchRec): XLabel | undefined {
  if (!c.history.some((s) => s.basis !== undefined)) return undefined;
  return (t) => {
    const snap = snapAtOrBefore(c.history, t) ?? c.history[0]!;
    const anchor = snap.basis !== undefined ? snap : c.history.find((s) => s.basis !== undefined)!;
    return formatCalDate(
      tickToMs(t, anchor.unit, anchor.basis!, anchor.convention ?? DEFAULT_DAY_COUNT),
    );
  };
}

function snapDate(snap: Snapshot): string {
  if (snap.basis === undefined) return "";
  return ` · ${formatCalDate(tickToMs(snap.t, snap.unit, snap.basis, snap.convention ?? DEFAULT_DAY_COUNT))}`;
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
  // Hold-last: a playhead parked in the sparse gap of a cross-unit fork
  // reads the most recent committed snapshot, not the first one.
  return snapAtOrBefore(cur().history, state.playhead);
}

function renderView(): void {
  const c = cur();
  if (c.history.length === 0) return;
  const xLabel = xLabelFor(c);
  if (c.mc && c.summary) {
    renderMonteCarloView(c, xLabel);
    return;
  }
  const ghost = ghostOf();
  const stocks = renderStocks(stocksSvg, c.history, state.playhead, state.mode, state.hidden, ghost, xLabel);
  const derived = renderDerived(derivedSvg, c.history, state.playhead, state.hidden, ghost, xLabel);
  const diffPane = $("diff-pane");
  if (c.forkT !== undefined && diffable()) {
    diffPane.hidden = false;
    renderLegend($("diff-legend"), renderDiff(diffSvg, trunk().history, c.history, c.forkT, state.playhead, state.hidden, xLabel));
  } else {
    diffPane.hidden = true;
    diffSvg.innerHTML = "";
  }
  renderLegend($("stocks-legend"), stocks);
  renderLegend($("derived-legend"), derived);
  const snap = currentSnap();
  $("playhead-label").textContent =
    `t=${state.playhead} · ${c.horizon.unit}` +
    (snap ? `${snapDate(snap)} · ${stockValues()}` : "");
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

// ---- Monte Carlo view (milestone 8) --------------------------------------
// Bands replace point lines while the paths are in play: p10–p90 outer,
// p25–p75 inner, median on top (chart.ts). No per-tick rule highlighting —
// deltas are a single-path notion — the inspector shows the tick's
// distribution instead.

function medLabelOf(labels: readonly string[]): string {
  return labels.includes("p50") ? "p50" : labels[Math.floor(labels.length / 2)]!;
}

function rowAtT(summary: PercentileSummary, t: number): PercentileRow {
  let row = summary.rows[0]!;
  for (const r of summary.rows) {
    if (r.t <= t) row = r;
    else break;
  }
  return row;
}

function renderMonteCarloView(c: BranchRec, xLabel?: XLabel): void {
  const mc = c.mc!;
  const summary = c.summary!;
  const stocks = renderBands(stocksSvg, summary, state.playhead, state.hidden, {
    kind: "stocks",
    h: 280,
    forkT: c.forkT,
    xLabel,
  });
  const derived = renderBands(derivedSvg, summary, state.playhead, state.hidden, {
    kind: "derived",
    h: 150,
    perSeries: true,
    title: "mc derived ~",
    forkT: c.forkT,
    xLabel,
  });
  // Same restore path as the plain pane: hidden only while this run derives
  // nothing at all.
  const derivedPane = $("derived-pane");
  derivedPane.style.display = derived.length === 0 ? "none" : "";
  $("diff-pane").hidden = true;
  renderLegend($("stocks-legend"), stocks);
  renderLegend($("derived-legend"), derived);
  const row = rowAtT(summary, state.playhead);
  const when =
    row.basis === undefined
      ? ""
      : ` · ${formatCalDate(tickToMs(row.t, row.unit, row.basis, row.convention ?? DEFAULT_DAY_COUNT))}`;
  const med = medLabelOf(summary.labels);
  const values = Object.entries(row.stocks)
    .map(([n, s]) => `${n}=${fmtNum(s[med] ?? 0)}`)
    .join("  ");
  $("playhead-label").textContent =
    `t=${state.playhead} · ${c.horizon.unit}${when} · mc ${mc.paths} paths · seed ${mc.seed} · ${med} ${values}`;
  editor.setHighlights(new Set());

  if (state.tab === "inspector") {
    renderPercentileInspector(tabBody, row, stockColors(), c.horizon.unit, summary.labels, mc.paths, mc.seed);
  } else if (!tabBody.querySelector("pre")) {
    tabBody.innerHTML = `<pre class="raw">${escapeHtml(formatPercentileTable(summary))}</pre>`;
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

function mcInputs(): { paths: number; seed: number } {
  const raw = ($("mc-paths") as unknown as HTMLInputElement).value.trim();
  const paths = raw === "" ? 0 : Number(raw);
  if (paths !== 0 && (!Number.isInteger(paths) || paths < 1)) {
    throw new Error(`mc paths must be a whole number >= 1 (got ${raw})`);
  }
  const rawSeed = ($("mc-seed") as unknown as HTMLInputElement).value.trim();
  const seed = rawSeed === "" ? DEFAULT_MC_SEED : Number(rawSeed);
  if (!Number.isInteger(seed)) throw new Error(`mc seed must be an integer (got ${rawSeed})`);
  return { paths, seed };
}

async function runNow(): Promise<void> {
  const code = editor.text;
  try {
    const compiled = compileModel(code);
    const base = compiled.model.horizon;
    const override = horizonOverride(
      ($("h-start") as unknown as HTMLInputElement).value,
      ($("h-end") as unknown as HTMLInputElement).value,
      ($("h-unit") as unknown as HTMLSelectElement).value,
      ($("h-convention") as unknown as HTMLSelectElement).value,
      base,
    );
    const horizon = override ?? base;
    const { paths: mcPaths, seed: mcSeed } = mcInputs();
    const c = cur();
    const t = performance.now();
    let status: string;
    if (c.forkT === undefined) {
      // The deterministic run is always folded — it is the expected-value
      // baseline the bands sit on, and the timeline that scrubbing, forking
      // and branch re-forks ride on. Monte Carlo paths ride alongside it.
      const history = run(compiled.model, override);
      let mc: MonteCarloResult | undefined;
      if (mcPaths > 0) {
        mc = await runPathsPool(compiled.model, code, horizon, mcPaths, mcSeed);
      }
      const ms = performance.now() - t;
      c.code = code;
      c.model = compiled.model;
      c.history = history;
      c.horizon = horizon;
      c.ruleLines = collectRuleLines(compiled.model, compiled);
      c.mc = mc;
      c.summary = mc ? summarizeMonteCarlo(mc, MC_UI_PERCENTILES) : undefined;
      // Branches ride out trunk edits: re-fork them from the new trunk at
      // their original tick (their Monte Carlo from the new trunk's paths,
      // keeping the branch's own seed). Forks whose tick fell out of the new
      // horizon or whose unit no longer matches are dropped.
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
          b.history = fork(history, b.forkT, b.model, { label: b.label, horizon: b.horizon }).snapshots;
          if (b.mc) {
            if (!mc) throw new Error("the trunk is deterministic again");
            // Continue the *new* trunk's world: its seed, not the old branch's.
            b.mc = forkMonteCarlo(mc, b.forkT, b.model, { horizon: b.horizon });
            b.summary = summarizeMonteCarlo(b.mc, MC_UI_PERCENTILES);
          } else {
            b.summary = undefined;
          }
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
      status = mc
        ? `mc — ${mc.paths} paths × ${history.length - 1} ticks · seed ${mc.seed} · ${ms.toFixed(1)}ms${forkNote}`
        : `ok — ${history.length - 1} ticks · ${ms.toFixed(1)}ms${forkNote}`;
    } else {
      if (trunk().history.length === 0) throw new Error("branches need the trunk — run main first");
      const b = fork(trunk().history, c.forkT, compiled.model, { label: c.label, horizon });
      // Monte Carlo on a branch forks the trunk's *paths*: path i continues
      // path i's shocks (fold replays the prefix stream), so the band gap
      // vs the trunk is the what-if's effect with the noise held fixed.
      let mc: MonteCarloResult | undefined;
      if (mcPaths > 0) {
        const th = trunk();
        if (!th.mc) {
          throw new Error("Monte Carlo branches fork the trunk's paths — run main with mc paths first");
        }
        // Always inherit the trunk's seed — a branch is the same world.
        mc = forkMonteCarlo(th.mc, c.forkT, compiled.model, { horizon });
      }
      const ms = performance.now() - t;
      c.code = code;
      c.model = compiled.model;
      c.history = b.snapshots;
      c.horizon = b.horizon;
      c.ruleLines = collectRuleLines(compiled.model, compiled);
      c.mc = mc;
      c.summary = mc ? summarizeMonteCarlo(mc, MC_UI_PERCENTILES) : undefined;
      status = mc
        ? `${c.label} · mc — ${mc.paths} paths × ${b.snapshots.length - 1} ticks · seed ${mc.seed} · ${ms.toFixed(1)}ms · forked @t=${c.forkT}`
        : `${c.label} · ok — ${b.snapshots.length - 1} ticks · ${ms.toFixed(1)}ms · forked @t=${c.forkT}`;
    }
    const c2 = cur();
    // A fork variant can introduce stocks/derivations after the shared prefix,
    // so keep hidden toggles for anything present anywhere in the timeline.
    const present = new Set<string>();
    for (const s of c2.history) {
      for (const k of Object.keys(s.stocks)) present.add(k);
      for (const k of Object.keys(s.derived)) present.add(k);
    }
    state.hidden = new Set([...state.hidden].filter((n) => present.has(n)));
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
  const t = trunkTickAtPlayhead();
  if (t === undefined) {
    setStatus("cannot fork here: the playhead has no matching trunk moment", true);
    return;
  }
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

// "Fork here" always anchors to a trunk snapshot. On a re-ticked branch the
// playhead is in branch ticks, so map it by duration and take the trunk moment
// in force then (hold-last) rather than trusting the tick number.
function trunkTickAtPlayhead(): number | undefined {
  const c = cur();
  const th = trunk().history;
  if (th.length === 0) return undefined;
  if (c === trunk() || c.history.length === 0 || sameScale()) return state.playhead;
  const snap = snapAtOrBefore(c.history, state.playhead) ?? c.history[0]!;
  const b0 = th[0]!;
  const last = th[th.length - 1]!;
  // Dated timelines align by civil moment (leap-true month/year ticks); the
  // fixed day ratio is only the fallback for undated timelines.
  if (snap.basis !== undefined && b0.basis !== undefined) {
    const ms = tickToMs(snap.t, snap.unit, snap.basis, snap.convention ?? DEFAULT_DAY_COUNT);
    const lastMs = tickToMs(last.t, last.unit, last.basis ?? b0.basis, last.convention ?? DEFAULT_DAY_COUNT);
    // Past the trunk's end there is no moment to fork from — don't clamp it
    // onto the final snapshot, which would silently move the what-if earlier.
    if (ms > lastMs + 1e-6) return undefined;
    const eqTick = tickAtOrBefore(ms, b0.unit, b0.basis, b0.convention ?? DEFAULT_DAY_COUNT);
    // Likewise, a moment before the trunk's first tick has nothing to fork.
    if (eqTick < b0.t) return undefined;
    return snapAtOrBefore(th, eqTick)?.t;
  }
  const c0 = c.history[0]!;
  const ratio =
    daysPerTick(c0.unit, c0.convention ?? DEFAULT_DAY_COUNT) /
    daysPerTick(b0.unit, b0.convention ?? DEFAULT_DAY_COUNT);
  const eqTick = b0.t + (state.playhead - c0.t) * ratio;
  if (eqTick > last.t + 1e-9) return undefined;
  return snapAtOrBefore(th, eqTick)?.t;
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

$("h-convention").addEventListener("change", () => {
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
  const c = cur();
  if (c.summary) {
    download("kairotron-mc.csv", formatPercentileCsv(c.summary), "text/csv");
    return;
  }
  if (c.history.length) download("kairotron.csv", formatCsv(c.history), "text/csv");
});
$("exp-json").addEventListener("click", () => {
  const c = cur();
  if (!c.history.length) return;
  if (c.mc && c.summary) {
    // The percentiles, not the raw paths: N immutable timelines are big, and
    // the summary is the answer. Same seed reproduces the paths on reload.
    download(
      "kairotron-mc.json",
      JSON.stringify(
        {
          mode: "mc",
          branch: c.label,
          seed: c.mc.seed,
          paths: c.mc.paths,
          percentiles: c.summary.percentiles,
          horizon: c.horizon,
          rows: c.summary.rows,
        },
        null,
        2,
      ),
      "application/json",
    );
    return;
  }
  download(
    "kairotron.json",
    JSON.stringify({ branch: c.label, forkT: c.forkT, horizon: c.horizon, history: c.history }, null, 2),
    "application/json",
  );
});

window.addEventListener("keydown", (e) => {
  // Don't hijack arrows while typing or while a form control owns them.
  if (["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
  if (e.key === "ArrowLeft") setPlayhead(state.playhead - 1);
  if (e.key === "ArrowRight") setPlayhead(state.playhead + 1);
});

runNow();
