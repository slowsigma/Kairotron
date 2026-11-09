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
});
