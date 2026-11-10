import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import type { Snapshot } from "../src/core/types.js";
import type { Ghost } from "../web/src/chart.js";
import { renderStocks } from "../web/src/chart.js";

let dom: JSDOM;

beforeAll(async () => {
  const html = (await readFile("web/index.html", "utf8")).replace(/<script[\s\S]*?<\/script>/g, "");
  dom = new JSDOM(html);
  const g = globalThis as Record<string, unknown>;
  g.document = dom.window.document;
  g.window = dom.window;
  await import("../web/src/main.js");
});

const doc = () => dom.window.document;
const el = (sel: string) => doc().querySelector(sel) as HTMLElement;
const all = (sel: string): HTMLElement[] => [...doc().querySelectorAll<HTMLElement>(sel)];

describe("browser REPL end to end (jsdom)", () => {
  it("runs the sample model on load and reports success", () => {
    expect(el("#status").textContent).toMatch(/^ok — 40 ticks/);
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("model({");
  });

  it("displays the declared basis: playhead, inspector header, and calendar axis", () => {
    // the sample anchors tick 0 to 2026-01-01 (actual/365)
    expect(el("#playhead-label").textContent).toContain("2026-01-01");
    expect(el("#tab-body").textContent).toContain("t = 0 (year ticks) · 2026-01-01");
    expect(el("#stocks-chart").innerHTML).toContain("2026-01-01");
    expect(el("#derived-chart").innerHTML).toContain("2066-01-01");
  });

  it("renders legends for stocks and derived series", () => {
    const names = all("#stocks-legend .item").map((i) => i.dataset.name);
    expect(names).toEqual(["preTax", "cash"]);
    expect(all("#derived-legend .item").map((i) => i.dataset.name)).toEqual(["~netWorth", "~preTaxShare"]);
    expect(el("#stocks-chart").innerHTML).toContain("<path");
    expect(el("#derived-chart").innerHTML).toContain("<polyline");
  });

  it("t=0 moved nothing; t=1 lights every responsible rule line in the editor", () => {
    expect(el("#tab-body").textContent).toContain("nothing moved at this tick");
    const slider = doc().querySelector("#slider") as HTMLInputElement;
    slider.value = "1";
    slider.dispatchEvent(new dom.window.Event("input"));
    expect(el("#playhead-label").textContent).toContain("t=1");
    // one yearly tick from the 2026 basis is the 2027 civil year
    expect(el("#playhead-label").textContent).toContain("2027-01-01");
    expect(all("#tab-body tr.delta").length).toBe(6); // 4 flows + 2 sides of the transfer
    const lit = all("#editor .mirror .ln.hl").map((l) => l.textContent ?? "");
    for (const rule of ["contribution", "growth", "salary divert", "interest", "annual top-up"]) {
      expect(lit.some((l) => l.includes(`"${rule}"`))).toBe(true);
    }
  });

  it("arrow keys walk the playhead", () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(el("#playhead-label").textContent).toContain("t=2");
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(el("#playhead-label").textContent).toContain("t=0");
  });

  it("legend clicks toggle series visibility", () => {
    all("#stocks-legend .item")[0].click();
    expect(all("#stocks-legend .item")[0].className).toContain("off");
    expect(el("#stocks-chart").innerHTML).not.toContain("8ab4ff");
    all("#stocks-legend .item")[0].click();
    expect(all("#stocks-legend .item")[0].className).not.toContain("off");
    expect(el("#stocks-chart").innerHTML).toContain("8ab4ff");
  });

  it("the table tab shows stocks and ~derived columns", () => {
    el('#tabs button[data-tab="table"]').click();
    const pre = el("#tab-body pre").textContent ?? "";
    expect(pre).toContain("preTax");
    expect(pre).toContain("~netWorth");
    // the dated sample prints a civil-date column
    expect(pre).toContain("date");
    expect(pre).toContain("2026-01-01");
  });

  it("forks at the playhead, diverges the variant, diffs it, and discards it", () => {
    const slider = doc().querySelector("#slider") as HTMLInputElement;
    slider.value = "10";
    slider.dispatchEvent(new dom.window.Event("input"));
    el("#fork").click();
    expect(el("#status").textContent).toMatch(/b1 forked at t=10/);
    expect(el("#branchbar").hidden).toBe(false);
    expect(all("#branchbar .chip").map((c) => c.dataset.label)).toEqual(["main", "b1"]);

    // edit the now-active branch's buffer: raise the contribution rate and add
    // a derivation only the variant computes
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace("rate(4000", "rate(5000");
    ta.value = ta.value.replace(
      'derived("preTaxShare"',
      'derived("hop", (c) => c.stocks.preTax * 2),\n    derived("preTaxShare"',
    );
    el("#run").click();
    expect(el("#status").textContent).toMatch(/^b1 · ok — 40 ticks/);
    // the variant's derived value must appear even though the branch's first
    // snapshot (the trunk's S0) doesn't carry it — the pane unions across runs
    expect(all("#derived-legend .item").map((i) => i.dataset.name)).toContain("~hop");

    // the trunk's continuation ghosts behind the branch, with a fork marker
    expect(el("#stocks-chart").innerHTML).toContain('stroke-dasharray="4 3"');
    expect(el("#stocks-chart").innerHTML).toContain('class="fork"');
    expect(el("#diff-pane").hidden).toBe(false);
    expect(el("#diff-chart").innerHTML).toContain("<polyline");
    expect(el("#diff-legend").textContent).toContain("ΔpreTax");

    // back to the trunk: buffers swap per branch, the Δ pane hides
    all("#branchbar .chip")[0].click();
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("rate(4000");
    expect(el("#diff-pane").hidden).toBe(true);

    // the branch keeps its edit while it lives; × discards it for good
    all("#branchbar .chip")[1].click();
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("rate(5000");
    all("#branchbar .chip")[1].querySelector<HTMLElement>(".x")!.click();
    expect(all("#branchbar .chip")).toHaveLength(1);
    expect(el("#branchbar").hidden).toBe(true);
    expect(el("#diff-pane").hidden).toBe(true);
  });

  it("hides the derived pane without derivations and restores it when they come back", () => {
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    const withDerived = ta.value;
    // strip the derived block (there are no ']' inside the derivation bodies;
    // the trailing comma after the block is left intact)
    ta.value = withDerived.replace(/derived:\s*\[[^\]]*\]/, "derived: []");
    el("#run").click();
    expect(el("#status").textContent).toContain("ok —");
    expect((el("#derived-pane") as HTMLElement).style.display).toBe("none");
    // re-add one: a bare display:none had no restore path, the pane stayed gone
    ta.value = ta.value.replace(
      "derived: [],",
      'derived: [\n    derived("back", (c) => c.stocks.preTax * 0.9)\n  ],',
    );
    el("#run").click();
    expect(el("#status").textContent).toContain("ok —");
    expect(el("#derived-chart").innerHTML).toContain("<polyline");
  });

  it("escapes quotes and markup from user-controlled names in the legend", () => {
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace(
      'derived("back", (c) => c.stocks.preTax * 0.9)',
      `derived('x"on"><b>i</b>', (c) => c.stocks.preTax * 0.9)`,
    );
    el("#run").click();
    expect(el("#status").textContent).toContain("ok —");
    const legend = el("#derived-legend");
    expect(legend.querySelector("b")).toBeNull(); // no injected element
    expect(legend.innerHTML).toContain("&quot;");
    expect(legend.querySelector<HTMLElement>(".item")!.dataset.name).toBe('~x"on"><b>i</b>');
  });
});

// Direct chart-level checks (renderStocks is DOM-free apart from needing an
// SVG node, so jsdom alone suffices — no editor wiring involved).
describe("stocks chart stacking semantics", () => {
  const snapOf = (t: number, stocks: Record<string, number>): Snapshot =>
    Object.freeze({
      t,
      unit: "month",
      stocks: Object.freeze({ ...stocks }),
      derived: Object.freeze({}),
      deltas: Object.freeze([]),
    }) as Snapshot;
  const svgOf = (): SVGSVGElement =>
    (doc().createElementNS("http://www.w3.org/2000/svg", "svg") as unknown) as SVGSVGElement;

  it("stacks negatives below the axis (diverging) instead of clipping them to 0", () => {
    const svg = svgOf();
    const history = [0, 1, 2, 3].map((t) => snapOf(t, { a: -1 }));
    const legend = renderStocks(svg, history, 0, "stacked", new Set());
    const stacked = new Set(legend.map((e) => e.name));
    expect(stacked).toEqual(new Set(["a"]));
    const inner = svg.innerHTML;
    // the y-scale reaches the most extreme stacked sum, not just the positives
    expect(inner).toContain(">-1</text>");
    // plot y runs 10 (top) .. 260 (bottom); the zero line sits at 135, so the
    // -1 band must live entirely at y >= 135 — clipping would pin it at y=10
    const path = inner.match(/<path fill="[^"]+"[^>]*d="M([^"]+)"/)![1];
    const ys = path.split("L").map((pt) => Number.parseFloat(pt.split(",")[1]!));
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(135);
    expect(Math.max(...ys)).toBeCloseTo(260, 6);
  });

  it("draws ghost continuation lines on the stacked surface, not at raw values", () => {
    const svg = svgOf();
    const history = [0, 1, 2, 3, 4].map((t) => snapOf(t, { a: 1, b: 2 }));
    const ghost: Ghost = {
      snapshots: [4, 5, 6].map((t) => snapOf(t, { a: 1, b: 2 })),
      forkT: 4,
    };
    renderStocks(svg, history, 4, "stacked", new Set(), ghost);
    const inner = svg.innerHTML;
    // stack totals: a=1, b=1+2=3 → yOf(3)=10 (top), yOf(1)=10+250·⅔≈176.67;
    // raw (unstacked) ghost b would sit at yOf(2)≈93.33 instead
    const ysOf = (color: string): number[] =>
      (inner.match(
        new RegExp(`<polyline fill="none" stroke="${color}"[^>]*points="([^"]+)"`),
      )?.[1] ?? "")
        .split("L")
        .map((pt) => Number.parseFloat(pt.split(",")[1]!));
    for (const y of ysOf("#8ab4ff")) expect(y).toBeCloseTo(176.66666666666666, 6);
    for (const y of ysOf("#ffab70")) expect(y).toBeCloseTo(10, 6);
    expect(ysOf("#ffab70").length).toBe(3); // the ghost's three after-fork ticks
  });
});
