import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

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
  });

  it("forks at the playhead, diverges the variant, diffs it, and discards it", () => {
    const slider = doc().querySelector("#slider") as HTMLInputElement;
    slider.value = "10";
    slider.dispatchEvent(new dom.window.Event("input"));
    el("#fork").click();
    expect(el("#status").textContent).toMatch(/b1 forked at t=10/);
    expect(el("#branchbar").hidden).toBe(false);
    expect(all("#branchbar .chip").map((c) => c.dataset.label)).toEqual(["main", "b1"]);

    // edit the now-active branch's buffer: raise the contribution rate
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace("rate(4000", "rate(5000");
    el("#run").click();
    expect(el("#status").textContent).toMatch(/^b1 · ok — 40 ticks/);

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
});
