import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;

beforeEach(async () => {
  vi.resetModules();
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
const chipLabels = (): (string | undefined)[] =>
  all("#branchbar .chip").map((c) => c.dataset.label);

function setPlayhead(value: string): void {
  const slider = doc().querySelector("#slider") as HTMLInputElement;
  slider.value = value;
  slider.dispatchEvent(new dom.window.Event("input"));
}

describe("branch bookkeeping regressions", () => {
  it("discarding an inactive branch before the active one keeps the active branch valid", () => {
    setPlayhead("5");
    el("#fork").click(); // b1
    setPlayhead("8");
    el("#fork").click(); // b2, active
    expect(chipLabels()).toEqual(["main", "b1", "b2"]);

    // Discard b1 (index 1) while b2 (index 2) is active.
    all("#branchbar .chip")[1].querySelector<HTMLElement>(".x")!.click();

    expect(chipLabels()).toEqual(["main", "b2"]);
    expect(all("#branchbar .chip.active").map((c) => c.dataset.label)).toEqual(["b2"]);
  });

  it("refreshes the branch bar when a trunk re-run drops a branch", () => {
    setPlayhead("10");
    el("#fork").click(); // b1, active
    expect(chipLabels()).toEqual(["main", "b1"]);

    all("#branchbar .chip")[0].click(); // back to the trunk
    (doc().querySelector("#h-end") as HTMLInputElement).value = "5";
    el("#run").click(); // b1's fork tick is now outside the trunk

    expect(el("#status").textContent).toContain("dropped b1");
    expect(chipLabels()).toEqual(["main"]);
    expect(el("#branchbar").hidden).toBe(true);
  });

  it("refreshes the table tab when switching branches", () => {
    el('#tabs button[data-tab="table"]').click();
    setPlayhead("3");
    el("#fork").click(); // b1 active, forked at t=3

    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace(
      "stocks: { preTax: 40000, cash: 8000 }",
      "stocks: { preTax: 40000, cash: 8000, novel: 123 }",
    );
    el("#run").click();
    expect(el("#tab-body pre").textContent).toContain("novel");

    all("#branchbar .chip")[0].click(); // back to the trunk
    expect(el("#tab-body pre").textContent).not.toContain("novel");
  });
});
