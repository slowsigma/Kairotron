import { describe, expect, it } from "vitest";
import {
  SCENARIOS_KEY,
  loadSets,
  parseRef,
  removeScenario,
  upsertScenario,
  writeSets,
  type ScenarioPayload,
  type StorageLike,
} from "../web/src/scenarios.js";

const memStore = (initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

const payload = (code: string, extra: Partial<ScenarioPayload> = {}): ScenarioPayload => ({
  code,
  ...extra,
});

describe("scenario store", () => {
  it("round-trips sets through storage", () => {
    const store = memStore();
    const sets = [
      { name: "retirement", scenarios: [{ name: "aggressive", payload: payload("model({a})", { horizon: { unit: "month" }, mc: { paths: "100" } }) }] },
      { name: "hydrology", scenarios: [{ name: "wet year", payload: payload("model({b})") }] },
    ];
    writeSets(store, sets);
    expect(Object.keys(store.data)).toEqual([SCENARIOS_KEY]);
    expect(loadSets(store)).toEqual(sets);
  });

  it("upsert replaces in place and appends otherwise", () => {
    let sets: ReturnType<typeof loadSets> = [];
    let r = upsertScenario(sets, "retirement", "aggressive", payload("a1"));
    sets = r.sets;
    expect(r.ref).toBe("0:0");
    r = upsertScenario(sets, "retirement", "cautious", payload("c1"));
    sets = r.sets;
    expect(r.ref).toBe("0:1");
    // re-saving "aggressive" updates it in place — no duplicate chip, no reorder
    r = upsertScenario(sets, "retirement", "aggressive", payload("a2"));
    sets = r.sets;
    expect(r.ref).toBe("0:0");
    expect(sets[0]!.scenarios.map((s) => [s.name, s.payload.code])).toEqual([
      ["aggressive", "a2"],
      ["cautious", "c1"],
    ]);
    r = upsertScenario(sets, "hydrology", "wet year", payload("w1"));
    expect(r.ref).toBe("1:0");
  });

  it("removing a set's last scenario removes the set", () => {
    const base = upsertScenario(
      upsertScenario([], "retirement", "aggressive", payload("a")).sets,
      "retirement",
      "cautious",
      payload("c"),
    ).sets;
    const one = removeScenario(base, "0:0");
    expect(one.removed).toBe("retirement · aggressive");
    expect(one.sets[0]!.scenarios.map((s) => s.name)).toEqual(["cautious"]);
    const none = removeScenario(one.sets, "0:0");
    expect(none.sets).toEqual([]);
    expect(none.removed).toBe("retirement · cautious");
    // stale refs (deleted sets shift indices) are inert
    const stale = removeScenario(one.sets, "5:9");
    expect(stale.sets).toBe(one.sets);
    expect(stale.removed).toBeUndefined();
  });

  it("parses refs and rejects junk", () => {
    expect(parseRef("1:2")).toEqual([1, 2]);
    expect(parseRef("x")).toEqual([-1, -1]);
    expect(parseRef("-1:0")).toEqual([-1, -1]);
  });

  it("degrades gracefully on unreadable or corrupt storage", () => {
    expect(loadSets(undefined)).toEqual([]);
    expect(loadSets({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toEqual([]);
    expect(loadSets(memStore({ [SCENARIOS_KEY]: "not json" }))).toEqual([]);
    expect(loadSets(memStore({ [SCENARIOS_KEY]: "{\"not\":\"an array\"}" }))).toEqual([]);
    expect(loadSets(memStore())).toEqual([]); // key absent
    expect(() => writeSets(undefined, [])).toThrow(/unavailable/);
  });

  it("drops malformed sets and scenarios, strips session fields from payloads", () => {
    const stored = [
      null,
      "junk",
      { name: "  ", scenarios: [] },
      { name: "no scenarios key" },
      {
        name: "mixed",
        scenarios: [
          { name: "ok", payload: payload("m1") },
          { name: "", payload: payload("m2") }, // nameless
          { name: "no code" }, // payload missing
          { name: "bad code", payload: { code: 123 } },
          null,
          // a payload smuggling session fields: stripped, scenario kept
          { name: "smuggler", payload: { code: "m3", playhead: 7, branches: [{ forkT: 1, code: "b" }] } },
        ],
      },
      { name: "all junk", scenarios: [{ nope: true }] },
    ];
    const sets = loadSets(memStore({ [SCENARIOS_KEY]: JSON.stringify(stored) }));
    expect(sets).toHaveLength(1);
    expect(sets[0]!.scenarios.map((s) => s.name)).toEqual(["ok", "smuggler"]);
    expect(sets[0]!.scenarios[1]!.payload).toEqual({ code: "m3" });
  });
});
