import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { SCENARIOS_KEY } from "../web/src/scenarios.js";

// Saving from a re-ticked branch used to store the trunk's code with the
// branch's toolbar horizon. A scenario is folded as a fresh trunk, so it must
// carry the trunk's actual horizon instead.

const htmlPromise = readFile("web/index.html", "utf8");

async function mount(): Promise<JSDOM> {
  const html = (await htmlPromise).replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: "http://kairotron.test/" });
  const g = globalThis as Record<string, unknown>;
  g.document = dom.window.document;
  g.window = dom.window;
  return dom;
}

const el = (dom: JSDOM, sel: string) => dom.window.document.querySelector(sel) as HTMLElement;
const input = (dom: JSDOM, id: string) =>
  dom.window.document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
const buffer = (dom: JSDOM) =>
  dom.window.document.querySelector("#editor textarea") as HTMLTextAreaElement;

describe("saving a scenario from a re-ticked branch", () => {
  it("stores the trunk's horizon, not the branch's controls", async () => {
    const dom = await mount();
    await import("../web/src/main.js");
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/^ok —/));

    el(dom, "#fork").click();
    expect(dom.window.document.querySelectorAll("#branchbar .chip")).toHaveLength(2);

    // Diverge the branch's code too, so the saved trunk code is distinguishable.
    buffer(dom).value = buffer(dom).value.replace("rate(4000", "rate(5000");
    const unit = input(dom, "h-unit") as HTMLSelectElement;
    unit.value = "month";
    unit.dispatchEvent(new dom.window.Event("change"));
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/^b1 · ok/));

    el(dom, "#scen-save").click();
    (input(dom, "save-name") as HTMLInputElement).value = "from branch";
    el(dom, "#save-ok").click();
    expect(el(dom, "#status").textContent).toBe("saved default · from branch");

    type StoredScenario = { name: string; payload: { code: string; horizon?: unknown } };
    const stored = JSON.parse(dom.window.localStorage.getItem(SCENARIOS_KEY)!) as {
      scenarios: StoredScenario[];
    }[];
    const scen = stored.flatMap((s) => s.scenarios).find((s) => s.name === "from branch");
    expect(scen?.payload.code).toContain("rate(4000");
    expect(scen?.payload.code).not.toContain("rate(5000");
    expect(scen?.payload.horizon).toEqual({
      start: "0",
      end: "40",
      unit: "year",
      convention: "actual/365",
    });
  });
});
