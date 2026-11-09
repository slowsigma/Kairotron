import { describe, expect, it } from "vitest";
import { fork, run } from "../src/core/fold.js";
import { flow, lagged, model, once } from "../src/dsl/model.js";

const trunkModel = model({
  horizon: { start: 0, end: 10, unit: "month" },
  stocks: { fund: 100, sink: 0 },
  rules: [flow("fund", 10, "deposit")],
});

describe("fork", () => {
  it("re-forking the trunk with the same model reproduces it and shares snapshots by reference", () => {
    const trunk = run(trunkModel);
    const b = fork(trunk, 4, trunkModel, { label: "same" });
    expect(b.snapshots.map((s) => s.stocks.fund)).toEqual(trunk.map((s) => s.stocks.fund));
    expect(b.snapshots[2]).toBe(trunk[2]); // the prefix is shared, not copied
    expect(b.forkT).toBe(4);
    expect(b.label).toBe("same");
    expect(Object.isFrozen(b)).toBe(true);
  });

  it("a variant diverges only after the fork tick and leaves the trunk untouched", () => {
    const trunk = run(trunkModel);
    const boost = model({
      horizon: { start: 0, end: 10, unit: "month" },
      stocks: { fund: 0, sink: 0 }, // declared initials are ignored — state comes from the snapshot
      rules: [flow("fund", 20, "double deposit")],
    });
    const b = fork(trunk, 5, boost);
    expect(b.snapshots[5].stocks.fund).toBe(150);
    expect(b.snapshots[5]).toBe(trunk[5]);
    expect(b.snapshots[6].stocks.fund).toBe(170);
    expect(trunk[6].stocks.fund).toBe(160); // trunk unchanged
    expect(b.snapshots[6].deltas[0]!.rule).toBe("double deposit");
  });

  it("lag reads across the fork point into the shared trunk history", () => {
    const trunk = run(trunkModel);
    const echo = model({
      horizon: { start: 0, end: 10, unit: "month" },
      stocks: { fund: 0, sink: 0 },
      rules: [flow("sink", lagged("fund", 3), "lagged echo")],
    });
    const b = fork(trunk, 5, echo);
    // sink at t=6 reads fund at t=3 — pre-fork values from the trunk
    expect(b.snapshots[6]!.stocks.sink).toBe(130);
    expect(b.snapshots[6]!.deltas[0]!.amount).toBe(130);
    // lags reaching before the *trunk's* S0 clamp to the trunk's S0
    const deep = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { fund: 0, sink: 0 },
      rules: [flow("sink", lagged("fund", 5), "deep echo")],
    });
    const from1 = fork(trunk, 1, deep);
    expect(from1.snapshots[2]!.stocks.sink).toBe(100);
  });

  it("stock overrides land on the fork snapshot with provenance; the trunk's snapshot is untouched", () => {
    const trunk = run(trunkModel);
    const b = fork(trunk, 4, trunkModel, { stocks: { fund: 1000 } });
    expect(trunk[4]!.stocks.fund).toBe(140); // original frozen snapshot intact
    expect(b.snapshots[4]!.stocks.fund).toBe(1000);
    expect(b.snapshots[4]!.deltas).toEqual([{ stock: "fund", amount: 860, rule: "fork @t=4" }]);
    expect(b.snapshots[3]).toBe(trunk[3]); // still shares everything before the fork
    expect(b.snapshots[5]!.stocks.fund).toBe(1010); // override carries through the fold
  });

  it("a variant can introduce new stocks at their declared initial and extend the horizon", () => {
    const trunk = run(trunkModel);
    const longer = model({
      horizon: { start: 0, end: 14, unit: "month" },
      stocks: { fund: 0, sink: 0, reserve: 500 }, // reserve enters at the fork
      rules: [flow("fund", 10, "deposit")],
    });
    const b = fork(trunk, 8, longer);
    expect(b.snapshots).toHaveLength(15);
    expect(b.snapshots[8]!.stocks.reserve).toBeUndefined(); // the shared prefix is the trunk's own snapshots
    expect(b.snapshots[9]!.stocks.reserve).toBe(500); // the new stock enters at the branch's first tick
    expect(b.snapshots[14]!.stocks.fund).toBe(100 + 14 * 10);
  });

  it("schedules keep firing on absolute ticks after the fork, never re-firing before it", () => {
    const trunk = run(model({ horizon: { start: 0, end: 10, unit: "month" }, stocks: { a: 0 }, rules: [] }));
    const variant = model({
      horizon: { start: 0, end: 10, unit: "month" },
      stocks: { a: 0 },
      rules: [once(3, flow("a", 5, "early bonus")), once(7, flow("a", 5, "late bonus"))],
    });
    const fired = fork(trunk, 5, variant).snapshots.flatMap((s) => s.deltas.map((d) => d.rule));
    expect(fired).toEqual(["late bonus"]);
  });

  it("validates fork points and overrides", () => {
    const trunk = run(trunkModel);
    expect(() => fork([], 0, trunkModel)).toThrow(/non-empty history/);
    expect(() => fork(trunk, 3.5, trunkModel)).toThrow(/integer tick/);
    expect(() => fork(trunk, 99, trunkModel)).toThrow(/not in the history/);
    expect(() => fork(trunk, 10, trunkModel)).toThrow(/nothing left to run/);
    expect(() => fork(trunk, 4, trunkModel, { horizon: { start: 6, end: 12, unit: "month" } })).toThrow(
      /before the branch horizon start/,
    );
    expect(() => fork(trunk, 4, trunkModel, { stocks: { fund: Number.NaN } })).toThrow(
      /fork override 'fund' must be finite/,
    );
  });
});
