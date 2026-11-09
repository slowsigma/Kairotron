import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { between, every, flow, lagged, laggedDelta, model, once, transfer, unless, when } from "../src/dsl/model.js";
import { rate } from "../src/dsl/model.js";

const ticksWith = (m: ReturnType<typeof model>, label: string): number[] =>
  run(m)
    .filter((s) => s.deltas.some((d) => d.rule === label))
    .map((s) => s.t);

describe("recurring schedules", () => {
  const m = (rule: Parameters<typeof every>[1], offset = 0) =>
    model({
      horizon: { start: 0, end: 12, unit: "month" },
      stocks: { a: 0 },
      rules: [every(3, flow("a", 10, "drip"), offset)],
    });

  it("every(3) fires on multiples of 3 (never on tick 0)", () => {
    const history = run(
      model({ horizon: { start: 0, end: 12, unit: "month" }, stocks: { a: 0 }, rules: [every(3, flow("a", 10, "drip"))] }),
    );
    expect(history[12]!.stocks.a).toBe(40);
    expect(history[2]!.stocks.a).toBe(0);
  });

  it("offset anchors the period to an absolute tick", () => {
    expect(ticksWith(m(flow("a", 10, "drip"), 1), "drip")).toEqual([1, 4, 7, 10]);
  });

  it("every(rate(1,'quarter')) lands on 3 monthly ticks", () => {
    const q = model({
      horizon: { start: 0, end: 12, unit: "month" },
      stocks: { a: 0 },
      rules: [every(rate(1, "quarter"), flow("a", 10, "drip"))],
    });
    expect(ticksWith(q, "drip")).toEqual([3, 6, 9, 12]);
  });

  it("a rate-based interval that misses the tick grid throws at run time", () => {
    const q = model({
      horizon: { start: 0, end: 12, unit: "month" },
      stocks: { a: 0 },
      rules: [every(rate(1, "quarter"), flow("a", 10, "drip"))],
    });
    expect(() => run(q, { start: 0, end: 1, unit: "year" })).toThrow(/whole number of 'year' ticks/);
  });

  it("rejects fractional tick intervals at build time", () => {
    expect(() => every(2.5, flow("a", 1, "x"))).toThrow(/positive whole number/);
  });
});

describe("one-shot and windowed schedules", () => {
  it("once(t) fires on exactly one tick", () => {
    const m = model({
      horizon: { start: 0, end: 6, unit: "month" },
      stocks: { a: 0 },
      rules: [once(4, flow("a", 100, "grant"))],
    });
    expect(ticksWith(m, "grant")).toEqual([4]);
    expect(run(m)[6]!.stocks.a).toBe(100);
  });

  it("between(a,b) fires inclusively inside the window", () => {
    const m = model({
      horizon: { start: 0, end: 6, unit: "month" },
      stocks: { a: 0 },
      rules: [between(2, 4, flow("a", 10, "window"))],
    });
    expect(ticksWith(m, "window")).toEqual([2, 3, 4]);
  });

  it("rejects inverted or fractional windows", () => {
    const f = flow("a", 1, "x");
    expect(() => between(5, 2, f)).toThrow(/from <= to/);
    expect(() => between(1.5, 3, f)).toThrow(/integer bounds/);
  });
});

describe("guards", () => {
  const drain = model({
    horizon: { start: 0, end: 4, unit: "month" },
    stocks: { a: 25, b: 0 },
    rules: [
      flow("a", -10, "drain"),
      when((c) => c.stocks.a > 0, flow("b", 1, "bonus")),
    ],
  });

  it("when() gates on state; guards see same-tick effects of earlier rules", () => {
    const history = run(drain);
    expect(history[1]!.stocks).toEqual({ a: 15, b: 1 });
    expect(history[2]!.stocks).toEqual({ a: 5, b: 2 });
    expect(history[3]!.stocks).toEqual({ a: -5, b: 2 });
    expect(history[3]!.deltas).toHaveLength(1);
  });

  it("unless() is the complement", () => {
    const m = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { a: 25, b: 0 },
      rules: [flow("a", -10, "drain"), unless((c) => c.stocks.a > 0, flow("b", 99, "refill trigger"))],
    });
    const history = run(m);
    expect(history[2]!.deltas.some((d) => d.rule === "refill trigger")).toBe(false);
    expect(history[3]!.stocks.b).toBe(99);
  });

  it("delta provenance through a wrapper still names the inner rule and line", () => {
    const history = run(drain);
    const d = history[1]!.deltas[1]!;
    expect(d.rule).toBe("bonus");
    expect(d.loc?.file).toContain("gating.test.ts");
  });
});

describe("delays", () => {
  const lagModel = (ticks: number) =>
    model({
      horizon: { start: 0, end: 8, unit: "month" },
      stocks: { a: 0, b: 0 },
      rules: [flow("a", 10, "fill"), flow("b", lagged("a", ticks), "echo")],
    });

  it("lag(n) reads the committed value from n ticks back", () => {
    const history = run(lagModel(1));
    expect(history[1]!.stocks.b).toBe(0);
    expect(history[2]!.stocks.b).toBe(10);
    expect(history[3]!.stocks.b).toBe(30);
  });

  it("lags reaching before S0 clamp to the initial constant condition", () => {
    const history = run(lagModel(5));
    expect(history[5]!.stocks.b).toBe(0);
    expect(history[6]!.stocks.b).toBe(10);
    expect(history[7]!.stocks.b).toBe(30);
    expect(history[8]!.stocks.b).toBe(60);
  });

  it("laggedDelta(n) yields what the stock gained n ticks ago", () => {
    const m = model({
      horizon: { start: 0, end: 4, unit: "month" },
      stocks: { a: 0, b: 0 },
      rules: [flow("a", 10, "fill"), flow("b", laggedDelta("a", 2), "delayed echo")],
    });
    const history = run(m);
    expect(history[1]!.stocks.b).toBe(0);
    expect(history[2]!.stocks.b).toBe(0);
    expect(history[3]!.stocks.b).toBe(10);
    expect(history[4]!.stocks.b).toBe(20);
  });

  it("rejects lag < 1 ticks at build and run time", () => {
    expect(() => lagged("a", 0)).toThrow(/whole number of ticks >= 1/);
    const m = model({
      horizon: { start: 0, end: 1, unit: "month" },
      stocks: { a: 0 },
      rules: [flow("a", (c) => c.lag("a", 0), "bad lag")],
    });
    expect(() => run(m)).toThrow(/whole number of ticks >= 1/);
  });

  it("lagging an unknown stock throws at run time", () => {
    const m = model({
      horizon: { start: 0, end: 1, unit: "month" },
      stocks: { a: 0 },
      rules: [flow("a", (c) => c.lag("ghost", 1), "bad lag")],
    });
    expect(() => run(m)).toThrow(/unknown stock 'ghost'/);
  });
});

describe("composition and validation", () => {
  it("schedules and guards compose (when inside every)", () => {
    const m = model({
      horizon: { start: 0, end: 10, unit: "month" },
      stocks: { a: 0 },
      rules: [every(3, when((c) => c.stocks.a < 20, flow("a", 10, "topup")))],
    });
    const history = run(m);
    expect(history[10]!.stocks.a).toBe(20);
    expect(history[9]!.deltas).toHaveLength(0);
  });

  it("guards can transfer", () => {
    const m = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { tank: 50, spill: 0 },
      rules: [flow("tank", 25, "rain"), when((c) => c.stocks.tank > 60, transfer("tank", "spill", (c) => c.stocks.tank - 50, "weir overflow"))],
    });
    const history = run(m);
    expect(history[1]!.stocks).toEqual({ tank: 50, spill: 25 });
    expect(history[2]!.stocks).toEqual({ tank: 50, spill: 50 });
    expect(history[3]!.stocks).toEqual({ tank: 50, spill: 75 });
  });

  it("unknown stocks inside wrappers are caught at build time", () => {
    expect(() =>
      model({
        horizon: { start: 0, end: 1, unit: "month" },
        stocks: { a: 1 },
        rules: [every(2, flow("ghost", 1, "boo"))],
      }),
    ).toThrow(/references unknown stock 'ghost'/);
  });
});
