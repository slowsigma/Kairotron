import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { decodeShareParam, readShareParam } from "../web/src/share.js";

// Sharing from a re-ticked (cross-unit) branch used to store the branch's unit
// but the old trunk's fork tick/playhead, so the reload forked at the wrong
// moment. The payload must pin the trunk's own horizon and carry the branch's.

const htmlPromise = readFile("web/index.html", "utf8");

async function mount(url: string): Promise<JSDOM> {
  const html = (await htmlPromise).replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url });
  const g = globalThis as Record<string, unknown>;
  g.document = dom.window.document;
  g.window = dom.window;
  return dom;
}

const el = (dom: JSDOM, sel: string) => dom.window.document.querySelector(sel) as HTMLElement;
const input = (dom: JSDOM, id: string) => dom.window.document.getElementById(id) as HTMLInputElement | HTMLSelectElement;

describe("share from a re-ticked branch", () => {
  let param: string | undefined;

  it("stores the trunk's horizon and the branch's own tick grid", async () => {
    const dom = await mount("http://kairotron.test/");
    await import("../web/src/main.js");
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/^ok —/));

    input(dom, "slider").value = "20"; // park on trunk year 20
    input(dom, "slider").dispatchEvent(new dom.window.Event("input"));
    el(dom, "#fork").click();
    expect(el(dom, "#branchbar").querySelector(".chip.active")?.textContent).toContain("b1@20");

    const unit = input(dom, "h-unit") as HTMLSelectElement;
    unit.value = "month";
    unit.dispatchEvent(new dom.window.Event("change")); // re-tick the branch only
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/^b1 · ok/));

    el(dom, "#share").click();
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/share URL/));
    param = readShareParam(dom.window.location.href);
    const back = await decodeShareParam(param!);

    // trunk stays yearly (year 20), not the branch's monthly controls
    expect(back.horizon).toEqual({ start: "0", end: "40", unit: "year", convention: "actual/365" });
    // month tick 20 is Jan 2027 = trunk year tick 1
    expect(back.playhead).toBe(1);
    expect(back.branches).toEqual([
      {
        forkT: 20,
        code: expect.stringContaining("rate(4000"),
        horizon: { start: "0", end: "480", unit: "month", convention: "actual/365" },
      },
    ]);
  });

  it("rehydrates the trunk and forks the branch at the same trunk tick", async () => {
    vi.resetModules();
    const dom = await mount(`http://kairotron.test/?m=${param}`);
    await import("../web/src/main.js");
    await vi.waitFor(() => expect(el(dom, "#status").textContent).toMatch(/shared model loaded/));

    expect(el(dom, "#status").textContent).toBe("shared model loaded · 1 branch");
    expect(el(dom, "#playhead-label").textContent).toContain("t=1 · year");
    expect(el(dom, "#branchbar").querySelector(".chip.active")?.textContent).toBe("main");
    expect(el(dom, "#branchbar").querySelectorAll(".chip")[1]?.textContent).toBe("b1@20×");
  });
});
