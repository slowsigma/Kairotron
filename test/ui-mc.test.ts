import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

// jsdom has no Worker — mc-pool falls back to a sequential main-thread fold,
// so the browser MC path runs end to end deterministically in-process.

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

// runNow suspends at the (resolved) path-fold promise, so the status/render
// land a microtask after the click.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function runAndWait(): Promise<void> {
  el("#run").click();
  await settle();
}

describe("Monte Carlo in the browser REPL (jsdom)", () => {
  it("starts deterministic: no bands until paths are requested", () => {
    expect(el("#status").textContent).toMatch(/^ok — 40 ticks/);
    expect(el("#stocks-chart").innerHTML).not.toContain('fill-opacity="0.15"');
  });

  it("runs seeded paths and paints percentile bands over the stocks", async () => {
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace(
      'growth: pct(6.5, "year"),',
      'growth: stochastic(pct(6.5, "year"), normal(pct(18, "year"))),',
    );
    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "24";
    (doc().querySelector("#mc-seed") as HTMLInputElement).value = "7";
    await runAndWait();

    expect(el("#status").textContent).toMatch(/^mc — 24 paths × 40 ticks · seed 7/);
    const stocks = el("#stocks-chart").innerHTML;
    expect(stocks).toContain('fill-opacity="0.15"'); // p10–p90 outer band
    expect(stocks).toContain('fill-opacity="0.25"'); // p25–p75 inner band
    expect(stocks).toContain("stroke-width=\"1.8\""); // median line
    expect(el("#playhead-label").textContent).toContain("mc 24 paths · seed 7");
    // the derived pane also runs on bands (per-curve scale)
    expect(el("#derived-chart").innerHTML).toContain('fill-opacity="0.15"');
    // legend identity is unchanged — names still toggle
    expect(all("#stocks-legend .item").map((i) => i.dataset.name)).toEqual(["preTax", "cash"]);
  });

  it("the inspector shows the tick's distribution, the table the percentile grid", async () => {
    const slider = doc().querySelector("#slider") as HTMLInputElement;
    slider.value = "10";
    slider.dispatchEvent(new dom.window.Event("input"));
    expect(el("#tab-body").textContent).toContain("Monte Carlo · 24 paths · seed 7");
    expect(el("#tab-body").textContent).toContain("p50");
    el('#tabs button[data-tab="table"]').click();
    const pre = el("#tab-body pre").textContent ?? "";
    expect(pre).toContain("preTax·p25");
    expect(pre).toContain("~netWorth·p75");
    expect(pre).toContain("2036-01-01"); // the dated sample keeps its calendar axis
  });

  it("a branch continues the trunk's MC seed even if the form seed differs", async () => {
    const slider = doc().querySelector("#slider") as HTMLInputElement;
    slider.value = "10";
    slider.dispatchEvent(new dom.window.Event("input"));
    el("#fork").click();
    await settle();

    (doc().querySelector("#mc-seed") as HTMLInputElement).value = "99";
    await runAndWait();
    expect(el("#status").textContent).toMatch(/^b1 · mc — 24 paths .* seed 7/);

    // back to the trunk for the following tests
    all("#branchbar .chip")[0].click();
    (doc().querySelector("#mc-seed") as HTMLInputElement).value = "7";
    await runAndWait();
    expect(el("#status").textContent).toMatch(/^mc — 24 paths .* seed 7/);
  });

  it("same seed replays identical bands; turning mc off returns the plain view", async () => {
    await runAndWait();
    const once = el("#stocks-chart").innerHTML;
    await runAndWait();
    expect(el("#stocks-chart").innerHTML).toBe(once);

    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "";
    await runAndWait();
    expect(el("#status").textContent).toMatch(/^ok — 40 ticks/);
    expect(el("#stocks-chart").innerHTML).not.toContain('fill-opacity="0.15"');
    el('#tabs button[data-tab="inspector"]').click();
    // back to point semantics: the playhead's tick carries its six deltas again
    expect(el("#tab-body").textContent).toContain("this tick's deltas (6)");
  });

  it("rejects nonsense mc inputs with a clear error", async () => {
    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "2.5";
    await runAndWait();
    expect(el("#status").textContent).toContain("mc paths must be a whole number >= 1");
    (doc().querySelector("#mc-seed") as HTMLInputElement).value = "1.5";
    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "8";
    await runAndWait();
    expect(el("#status").textContent).toContain("mc seed must be an integer");
    (doc().querySelector("#mc-seed") as HTMLInputElement).value = "";
  });

  it("a model without stochastic constants still takes an MC run (degenerate bands)", async () => {
    const ta = doc().querySelector("#editor textarea") as HTMLTextAreaElement;
    ta.value = ta.value.replace(
      'growth: stochastic(pct(6.5, "year"), normal(pct(18, "year"))),',
      'growth: pct(6.5, "year"),',
    );
    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "5";
    await runAndWait();
    expect(el("#status").textContent).toMatch(/^mc — 5 paths/);
    // every percentile collapses onto the deterministic line
    const pre = (() => {
      el('#tabs button[data-tab="table"]').click();
      return el("#tab-body pre").textContent ?? "";
    })();
    expect(pre).toContain("preTax·p10");
    el('#tabs button[data-tab="inspector"]').click();
    (doc().querySelector("#mc-paths") as HTMLInputElement).value = "";
    await runAndWait();
  });
});
