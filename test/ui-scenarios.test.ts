import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SCENARIOS_KEY } from "../web/src/scenarios.js";

let dom: JSDOM;

beforeAll(async () => {
  const html = (await readFile("web/index.html", "utf8")).replace(/<script[\s\S]*?<\/script>/g, "");
  dom = new JSDOM(html, { url: "http://kairotron.test/" });
  const g = globalThis as Record<string, unknown>;
  g.document = dom.window.document;
  g.window = dom.window;
  await import("../web/src/main.js");
  await vi.waitFor(() =>
    expect(dom.window.document.getElementById("status")?.textContent).toMatch(/^ok —/),
  );
});

const doc = () => dom.window.document;
const el = (sel: string) => doc().querySelector(sel) as HTMLElement;
const input = (id: string) => doc().getElementById(id) as HTMLInputElement | HTMLSelectElement;
const buffer = () => doc().querySelector("#editor textarea") as HTMLTextAreaElement;

describe("saved scenario sets (jsdom)", () => {
  it("starts with an empty store and a placeholder select", () => {
    const sel = input("scenario") as HTMLSelectElement;
    expect(sel.options).toHaveLength(1);
    expect(sel.value).toBe("");
    expect(el("#save-pane").hidden).toBe(true);
  });

  it("saves the current model + controls into a named set", () => {
    buffer().value = buffer().value.replace("rate(4000", "rate(4100");
    (input("h-unit") as HTMLSelectElement).value = "month";
    input("h-unit").dispatchEvent(new dom.window.Event("change")); // re-ticks immediately

    el("#scen-save").click();
    expect(el("#save-pane").hidden).toBe(false);
    expect((input("save-set") as HTMLInputElement).value).toBe("default");
    expect((input("save-name") as HTMLInputElement).value).toBe("scenario 1");

    (input("save-name") as HTMLInputElement).value = "aggressive";
    el("#save-ok").click();
    expect(el("#status").textContent).toBe("saved default · aggressive");
    expect(el("#save-pane").hidden).toBe(true);

    const sel = input("scenario") as HTMLSelectElement;
    expect(sel.querySelector("optgroup")?.label).toBe("default");
    expect(sel.options[1].textContent).toBe("aggressive");

    const raw = dom.window.localStorage.getItem(SCENARIOS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([
      {
        name: "default",
        scenarios: [
          { name: "aggressive", payload: { code: expect.stringContaining("rate(4100"), horizon: { unit: "month" } } },
        ],
      },
    ]);
  });

  it("loading a scenario restores the buffer and controls, then re-runs", async () => {
    buffer().value = buffer().value.replace("rate(4100", "rate(7777");
    el("#run").click();
    expect(el("#status").textContent).toMatch(/^ok —/); // the edited buffer still runs

    const sel = input("scenario") as HTMLSelectElement;
    sel.value = "0:0";
    sel.dispatchEvent(new dom.window.Event("change"));
    await vi.waitFor(() =>
      expect(el("#status").textContent).toBe("loaded default · aggressive"),
    );
    expect(buffer().value).toContain("rate(4100");
    expect(buffer().value).not.toContain("7777");
    expect((input("h-unit") as HTMLSelectElement).value).toBe("month");
    expect(el("#stocks-chart").innerHTML).toContain("<path");
  });

  it("deletes the selected scenario and clears the storage entry", () => {
    const sel = input("scenario") as HTMLSelectElement;
    expect(sel.value).toBe("0:0");
    el("#scen-del").click();
    expect(el("#status").textContent).toBe("deleted default · aggressive");
    expect(sel.options).toHaveLength(1);
    expect(JSON.parse(dom.window.localStorage.getItem(SCENARIOS_KEY)!)).toEqual([]);
  });

  it("requires a scenario name and a selection to delete", () => {
    el("#scen-save").click();
    (input("save-name") as HTMLInputElement).value = "   ";
    el("#save-ok").click();
    expect(el("#status").textContent).toBe("scenario name is required");
    expect(el("#save-pane").hidden).toBe(false); // the pane stays open for a retry
    el("#save-cancel").click();
    expect(el("#save-pane").hidden).toBe(true);

    (input("scenario") as HTMLSelectElement).value = "";
    el("#scen-del").click();
    expect(el("#status").textContent).toBe("select a saved scenario to delete");
  });

  it("loading a scenario from a branch returns to the trunk and drops branches", async () => {
    el("#scen-save").click();
    (input("save-name") as HTMLInputElement).value = "branch source";
    el("#save-ok").click();
    expect(el("#status").textContent).toBe("saved default · branch source");

    el("#fork").click();
    expect(doc().querySelectorAll("#branchbar .chip")).toHaveLength(2);

    const sel = input("scenario") as HTMLSelectElement;
    sel.value = "0:0";
    sel.dispatchEvent(new dom.window.Event("change"));
    await vi.waitFor(() => expect(el("#status").textContent).toBe("loaded default · branch source"));

    expect(doc().querySelectorAll("#branchbar .chip")).toHaveLength(1);
    expect(doc().querySelector("#branchbar .chip.active")?.textContent).toBe("main");
    expect(el("#branchbar").hidden).toBe(true);
  });

  it("a scenario whose model fails to fold keeps the error status", async () => {
    buffer().value = "model({ nope: true })";
    el("#scen-save").click();
    (input("save-name") as HTMLInputElement).value = "broken";
    el("#save-ok").click();
    expect(el("#status").textContent).toBe("saved default · broken");

    const sel = input("scenario") as HTMLSelectElement;
    sel.value = "0:1";
    sel.dispatchEvent(new dom.window.Event("change"));
    await vi.waitFor(() => expect(el("#status").textContent).toMatch(/model code failed|model requires a horizon/));
    expect(el("#status").classList.contains("err")).toBe(true);
    expect(el("#status").textContent).not.toMatch(/^loaded /);
    // the failed load still resets to a lone trunk
    expect(doc().querySelectorAll("#branchbar .chip")).toHaveLength(1);
  });
});
