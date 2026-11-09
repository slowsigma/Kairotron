import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { flow, model, pct, transfer } from "../src/dsl/model.js";

describe("fold", () => {
  const growthModel = model({
    horizon: { start: 0, end: 12, unit: "month" },
    constants: { growth: pct(7, "year") },
    stocks: { fund: 10000 },
    rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
  });

  it("compounds 7%/year over 12 monthly ticks with r/12 per tick", () => {
    const history = run(growthModel);
    const expected = 10000 * (1 + 0.07 / 12) ** 12;
    expect(history[12]!.stocks.fund).toBeCloseTo(expected, 8);
    expect(expected).toBeCloseTo(10722.901, 2);
  });

  it("the same model at yearly ticks gives the simple annual 7% (tick unit is semantics)", () => {
    const yearly = run(growthModel, { start: 0, end: 1, unit: "year" });
    expect(yearly[1]!.stocks.fund).toBeCloseTo(10700, 8);
  });

  it("history is [S0..SN] with S0 = initial state and no deltas", () => {
    const history = run(growthModel);
    expect(history).toHaveLength(13);
    expect(history[0]!.t).toBe(0);
    expect(history[0]!.stocks.fund).toBe(10000);
    expect(history[0]!.deltas).toEqual([]);
    expect(history[12]!.t).toBe(12);
  });

  it("snapshots are frozen (immutable history)", () => {
    const history = run(growthModel);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[5])).toBe(true);
    expect(Object.isFrozen(history[5]!.stocks)).toBe(true);
    expect(Object.isFrozen(history[5]!.deltas)).toBe(true);
  });

  it("deltas carry rule labels and source provenance", () => {
    const history = run(growthModel);
    const d = history[1]!.deltas[0]!;
    expect(d.rule).toBe("growth");
    expect(d.stock).toBe("fund");
    expect(d.loc).toBeDefined();
    expect(d.loc!.file).toContain("fold.test.ts");
  });
});

describe("transfers", () => {
  it("conserve the total across stocks", () => {
    const m = model({
      horizon: { start: 0, end: 5, unit: "month" },
      stocks: { wallet: 100, jar: 0 },
      rules: [transfer("wallet", "jar", 10, "weekly sweep")],
    });
    const history = run(m);
    const last = history[5]!;
    expect(last.stocks.wallet).toBeCloseTo(50, 10);
    expect(last.stocks.jar).toBeCloseTo(50, 10);
    expect(last.stocks.wallet! + last.stocks.jar!).toBeCloseTo(100, 10);
  });

  it("write paired deltas with equal and opposite amounts", () => {
    const m = model({
      horizon: { start: 0, end: 1, unit: "month" },
      stocks: { wallet: 100, jar: 0 },
      rules: [transfer("wallet", "jar", 10, "weekly sweep")],
    });
    const deltas = run(m)[1]!.deltas;
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.stock).toBe("wallet");
    expect(deltas[0]!.amount).toBeCloseTo(-10, 10);
    expect(deltas[1]!.stock).toBe("jar");
    expect(deltas[1]!.amount).toBeCloseTo(10, 10);
  });
});

describe("validation", () => {
  it("rejects rules referencing unknown stocks", () => {
    expect(() =>
      model({
        horizon: { start: 0, end: 1, unit: "month" },
        stocks: { a: 1 },
        rules: [flow("b", 1, "leak")],
      }),
    ).toThrow(/unknown stock 'b'/);
  });

  it("rejects unknown tick units", () => {
    expect(() =>
      model({
        // @ts-expect-error deliberate bad unit
        horizon: { start: 0, end: 1, unit: "fortnight" },
        stocks: { a: 1 },
        rules: [],
      }),
    ).toThrow(/unknown tick unit/);
  });

  it("rejects non-finite amounts at run time", () => {
    const m = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { a: 1 },
      rules: [flow("a", (c) => (c.t === 2 ? Number.NaN : 0), "bad rule")],
    });
    expect(() => run(m)).toThrow(/non-finite amount at t=2/);
  });
});
