import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { decodeShareParam, encodeShareParam, readShareParam } from "../web/src/share.js";
import { SAMPLE } from "../web/src/sample.js";

// A session worth sharing: a re-ticked monthly trunk, a parked playhead, and
// one de-risking branch. The URL must rebuild all of it — branches are shared
// as forks + buffers, replayed against the freshly folded trunk on load.
const TRUNK_CODE = SAMPLE.replace("rate(4000", "rate(4200");
const BRANCH_CODE = SAMPLE.replace("rate(4000", "rate(9000");
const PLAYHEAD = 120;
const FORK_T = 60;

let dom: JSDOM;

beforeAll(async () => {
  const html = (await readFile("web/index.html", "utf8")).replace(/<script[\s\S]*?<\/script>/g, "");
  const param = await encodeShareParam({
    code: TRUNK_CODE,
    horizon: { unit: "month" },
    playhead: PLAYHEAD,
    branches: [{ forkT: FORK_T, code: BRANCH_CODE }],
  });
  dom = new JSDOM(html, { url: `http://kairotron.test/?m=${param}` });
  const g = globalThis as Record<string, unknown>;
  g.document = dom.window.document;
  g.window = dom.window;
  await import("../web/src/main.js");
  // bootstrap() decodes and replays asynchronously — wait for its verdict
  await vi.waitFor(() =>
    expect(dom.window.document.getElementById("status")?.textContent).toMatch(/shared model loaded/),
  );
});

const doc = () => dom.window.document;
const el = (sel: string) => doc().querySelector(sel) as HTMLElement;
const all = (sel: string): HTMLElement[] => [...doc().querySelectorAll<HTMLElement>(sel)];

describe("shareable model URL (jsdom)", () => {
  it("loads the shared trunk: code, horizon controls, and parked playhead", () => {
    expect(el("#status").textContent).toBe("shared model loaded · 1 branch");
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("rate(4200");
    expect((doc().querySelector("#h-unit") as HTMLSelectElement).value).toBe("month");
    // 40 auto years re-ticked to months: the 120th monthly tick, dated from the basis
    expect(el("#playhead-label").textContent).toContain("t=120 · month");
    expect(el("#playhead-label").textContent).toContain("2036-01-01");
    expect(el("#stocks-chart").innerHTML).toContain("<path");
  });

  it("replays the shared branch: chip, forked overlay, and Δ-pane", () => {
    expect(el("#branchbar").hidden).toBe(false);
    // branch chips carry a discard × after the label
    expect(all("#branchbar .chip").map((c) => c.textContent)).toEqual(["main", `b1@${FORK_T}×`]);
    all("#branchbar .chip")[1].click();
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("rate(9000");
    expect(el("#diff-pane").hidden).toBe(false);
    expect(el("#diff-chart").innerHTML).toContain("<polyline");
    all("#branchbar .chip")[0].click();
    expect((doc().querySelector("#editor textarea") as HTMLTextAreaElement).value).toContain("rate(4200");
  });

  it("the Share button puts a decodable session URL in the address bar", async () => {
    el("#share").click();
    await vi.waitFor(() =>
      expect(el("#status").textContent).toMatch(/share URL (copied to clipboard|set in the address bar)/),
    );
    const param = readShareParam(dom.window.location.href);
    expect(param).toBeDefined();
    const back = await decodeShareParam(param!);
    expect(back.code).toContain("rate(4200");
    expect(back.horizon).toEqual({ unit: "month" });
    expect(back.playhead).toBe(PLAYHEAD);
    expect(back.branches).toEqual([{ forkT: FORK_T, code: BRANCH_CODE }]);
  });
});
