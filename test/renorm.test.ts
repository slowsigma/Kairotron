import { describe, expect, it } from "vitest";
import { fork, run, snapAtOrBefore } from "../src/core/fold.js";
import {
  DAY_COUNTS,
  convertTicks,
  daysPerTick,
  isDayCount,
  normalizeRate,
  retickHorizon,
  ticksPerInterval,
} from "../src/core/units.js";
import type { DayCount } from "../src/core/types.js";
import { every, flow, lagged, model, pct, rate } from "../src/dsl/model.js";
import { formatDiff } from "../src/outputs/table.js";
import retirement from "../examples/retirement.js";
import reservoir from "../examples/reservoir.js";

describe("day-count conventions", () => {
  it("three conventions, cleanly parsed", () => {
    expect(DAY_COUNTS).toEqual(["abstract", "actual/365", "30/360"]);
    for (const c of DAY_COUNTS) expect(isDayCount(c)).toBe(true);
    expect(isDayCount("actual/actual")).toBe(false);
  });

  it("month/year rates are identical across conventions; day-scaled ones differ", () => {
    for (const conv of DAY_COUNTS) {
      expect(normalizeRate(0.07, "year", "month", conv)).toBeCloseTo(0.07 / 12, 12);
    }
    expect(normalizeRate(0.07, "year", "day", "abstract")).toBeCloseTo(0.07 / 364, 12);
    expect(normalizeRate(0.07, "year", "day", "actual/365")).toBeCloseTo(0.07 / 365, 12);
    expect(normalizeRate(0.07, "year", "day", "30/360")).toBeCloseTo(0.07 / 360, 12);
    expect(normalizeRate(180, "month", "day", "30/360")).toBe(6);
  });

  it("a quarterly schedule lands on whole daily ticks under abstract and 30/360, not actual/365", () => {
    expect(ticksPerInterval(1, "quarter", "day", "abstract")).toBe(91);
    expect(ticksPerInterval(1, "quarter", "day", "30/360")).toBe(90);
    expect(ticksPerInterval(1, "quarter", "day", "actual/365")).toBeCloseTo(91.25, 10);
    const quarterly = model({
      horizon: { start: 0, end: 200, unit: "day", convention: "actual/365" },
      stocks: { a: 0 },
      rules: [every(rate(1, "quarter"), flow("a", 1, "quarterly"))],
    });
    expect(() => run(quarterly)).toThrow(/whole number of 'day' ticks/);

    for (const [conv, fired] of [["abstract", [91, 182]], ["30/360", [90, 180]]] as const) {
      const m = model({
        horizon: { start: 0, end: 200, unit: "day", convention: conv },
        stocks: { a: 0 },
        rules: [every(rate(1, "quarter"), flow("a", 1, "quarterly"))],
      });
      const ticks = run(m)
        .filter((s) => s.deltas.some((d) => d.rule === "quarterly"))
        .map((s) => s.t);
      expect(ticks, `quarterly fires under ${conv}`).toEqual(fired);
    }
  });

  it("the convention is declared on the model and reported by every snapshot", () => {
    const m = model({
      horizon: { start: 0, end: 1, unit: "day", convention: "30/360" },
      constants: { g: pct(7, "year") },
      stocks: { a: 100 },
      rules: [flow("a", (c) => c.stocks.a * c.perTick("g"), "growth")],
    });
    const history = run(m);
    expect(history[0]!.convention).toBe("30/360");
    expect(history[1]!.stocks.a).toBeCloseTo(100 * (1 + 0.07 / 360), 10);
    // the same model on the abstract year grows a hair more
    const abs = run(m, { ...m.horizon, convention: "abstract" });
    expect(abs[1]!.stocks.a).toBeCloseTo(100 * (1 + 0.07 / 364), 10);
    // and the default (undeclared) convention is abstract
    expect(run(reservoir)[0]!.convention).toBe("abstract");
  });

  it("model() rejects an unknown convention", () => {
    expect(
      () =>
        model({
          horizon: { start: 0, end: 1, unit: "day", convention: "30/365" as DayCount },
          stocks: { a: 0 },
          rules: [],
        }),
    ).toThrow(/unknown day-count convention '30\/365'/);
  });

  it("the day lengths behind every conversion", () => {
    expect(daysPerTick("month", "abstract")).toBeCloseTo(364 / 12, 10);
    expect(daysPerTick("quarter", "actual/365")).toBeCloseTo(91.25, 10);
    expect(daysPerTick("year", "30/360")).toBe(360);
    expect(daysPerTick("day")).toBe(1); // sub-day units ignore the convention
    expect(daysPerTick("hour", "actual/365")).toBeCloseTo(1 / 24, 12);
  });
});

describe("retickHorizon (duration-preserving re-tick)", () => {
  it("converts bounds through time, preserving the duration", () => {
    expect(retickHorizon({ start: 0, end: 12, unit: "month" }, "year")).toEqual({
      start: 0,
      end: 1,
      unit: "year",
      convention: "abstract",
    });
    expect(retickHorizon({ start: 0, end: 3, unit: "month" }, "day")).toEqual({
      start: 0,
      end: 91,
      unit: "day",
      convention: "abstract",
    });
    expect(retickHorizon({ start: 0, end: 15, unit: "month" }, "week")).toEqual({
      start: 0,
      end: 65,
      unit: "week",
      convention: "abstract",
    });
    expect(convertTicks(40, "year", "day")).toBe(14560);
  });

  it("round-trips where the ratio is exact", () => {
    const days = retickHorizon({ start: 0, end: 3, unit: "month" }, "day");
    expect(retickHorizon(days, "month")).toEqual({ start: 0, end: 3, unit: "month", convention: "abstract" });
  });

  it("the convention governs the conversion", () => {
    expect(retickHorizon({ start: 0, end: 12, unit: "month" }, "day", "actual/365").end).toBe(365);
    expect(retickHorizon({ start: 0, end: 12, unit: "month", convention: "30/360" }, "day").end).toBe(360);
    expect(retickHorizon({ start: 0, end: 12, unit: "month", convention: "30/360" }, "year").end).toBe(1);
  });

  it("rejects durations that don't land on whole ticks", () => {
    expect(() => retickHorizon({ start: 0, end: 7, unit: "month" }, "day")).toThrow(
      /horizon end = 212\.\d+ 'day' ticks — not a whole number under the 'abstract' day-count convention/,
    );
    expect(() => retickHorizon(reservoir.horizon, "week")).toThrow(/not a whole number/); // 60 days
  });

  it("same unit and no override is the identity (with the convention made explicit)", () => {
    expect(retickHorizon({ start: 0, end: 12, unit: "month" }, "month")).toEqual({
      start: 0,
      end: 12,
      unit: "month",
      convention: "abstract",
    });
  });
});

describe("re-ticking exemplars (tick unit is semantics)", () => {
  it("the retirement model re-ticks from 12 monthly ticks to 1 yearly tick", () => {
    const yearly = run(retirement, retickHorizon(retirement.horizon, "year"));
    expect(yearly).toHaveLength(2); // same duration: 12 months = 1 year
    // one annual tick: the contribution lands once at full size, growth is 7%
    expect(yearly[1]!.stocks.preTax).toBeCloseTo((120000 + 2750) * 1.07, 8);
  });

  it("monthly re-ticks to quarters exactly (48 months = 16 quarters)", () => {
    const quarterly = run(
      { ...retirement, horizon: { start: 0, end: 48, unit: "month" } },
      retickHorizon({ start: 0, end: 48, unit: "month" }, "quarter"),
    );
    expect(quarterly).toHaveLength(17);
    // growth per quarterly tick is 7%/4, the quarterly contribution lands once
    expect(quarterly[1]!.stocks.preTax).toBeCloseTo((120000 + 2750) * (1 + 0.07 / 4), 8);
  });

  it("the reservoir (60 days) cannot be re-ticked to weeks — 60 is not whole weeks", () => {
    expect(() => retickHorizon(reservoir.horizon, "week")).toThrow(/not a whole number/);
    // but 91 days of it is exactly a quarter, and 364 is a whole abstract year
    expect(retickHorizon({ start: 0, end: 91, unit: "day" }, "quarter").end).toBe(1);
    expect(retickHorizon({ start: 0, end: 364, unit: "day" }, "year").end).toBe(1);
  });
});

describe("cross-unit forks", () => {
  const trunkModel = model({
    horizon: { start: 0, end: 10, unit: "month" },
    stocks: { fund: 100, sink: 0 },
    rules: [flow("fund", 10, "deposit")],
  });
  const weeklyModel = model({
    horizon: { start: 0, end: 40, unit: "week" },
    stocks: { fund: 0, sink: 0 },
    rules: [flow("fund", 1, "weekly top-up")],
  });

  it("re-expresses the trunk prefix at whole branch ticks, sparse where durations don't land", () => {
    const trunk = run(trunkModel);
    const b = fork(trunk, 6, weeklyModel, { label: "weekly" });
    // months 1,2,4,5 fall between weeks; months 0,3,6 land on weeks 0,13,26
    expect(b.forkT).toBe(6);
    expect(b.forkTBranch).toBe(26);
    expect(b.snapshots.map((s) => s.t)).toEqual([0, 13, 26, ...Array.from({ length: 14 }, (_, i) => 27 + i)]);
    expect(b.snapshots.every((s) => s.unit === "week")).toBe(true);
    expect(b.snapshots[0]!.convention).toBe("abstract");
    expect(b.snapshots[1]!.stocks.fund).toBe(130); // trunk month 3
    expect(b.snapshots[2]!.stocks.fund).toBe(160); // trunk month 6 = the fork
    expect(b.snapshots[3]!.stocks.fund).toBe(161); // branch folds on from there
    expect(b.snapshots[1]).not.toBe(trunk[3]); // re-expressed copies...
    expect(b.snapshots[1]!.stocks).toBe(trunk[3]!.stocks); // ...over shared states
  });

  it("lag reads the sparse prefix with hold-last semantics", () => {
    const trunk = run(trunkModel);
    const echo = model({
      horizon: { start: 0, end: 40, unit: "week" },
      stocks: { fund: 0, sink: 0 },
      rules: [flow("sink", lagged("fund", 13), "echo")],
    });
    const b = fork(trunk, 6, echo);
    // at week 29 the 13-week lag asks for week 16 → the last prefix read is week 13
    const at29 = b.snapshots.find((s) => s.t === 29)!;
    expect(at29.deltas.find((d) => d.rule === "echo")!.amount).toBe(130);
    // and a lag reaching before the trunk's S0 clamps to S0
    const deep = model({
      horizon: { start: 0, end: 30, unit: "week" },
      stocks: { fund: 0, sink: 0 },
      rules: [flow("sink", lagged("fund", 40), "deep echo")],
    });
    expect(fork(trunk, 6, deep).snapshots.find((s) => s.t === 27)!.stocks.sink).toBe(100);
  });

  it("a fork point whose duration misses the branch tick grid is rejected", () => {
    const trunk = run(trunkModel);
    // 5 months = 21.6̅ weeks — a what-if can only happen at a real week
    expect(() => fork(trunk, 5, weeklyModel)).toThrow(/trunk snapshot t=5.*not a whole number/s);
    // mapping past the branch horizon end leaves nothing to run
    expect(() => fork(trunk, 9, weeklyModel, { horizon: { start: 0, end: 30, unit: "week" } })).toThrow(
      /maps to 39 'week' ticks, at or past the branch horizon end/,
    );
  });

  it("forks coarser too: a daily trunk continues on monthly branch ticks", () => {
    const daily = model({
      horizon: { start: 0, end: 200, unit: "day" },
      stocks: { fund: 100 },
      rules: [flow("fund", 1, "daily drip")],
    });
    const trunk = run(daily);
    const monthly = model({
      horizon: { start: 0, end: 8, unit: "month" },
      stocks: { fund: 0 },
      rules: [flow("fund", 100, "monthly deposit")],
    });
    const b = fork(trunk, 91, monthly); // day 91 = exactly 3 abstract months
    expect(b.forkT).toBe(91);
    expect(b.forkTBranch).toBe(3);
    expect(b.snapshots.map((s) => s.t)).toEqual([0, 3, 4, 5, 6, 7, 8]);
    expect(b.snapshots[1]!.stocks.fund).toBe(191); // the day-91 state
    expect(b.snapshots[2]!.stocks.fund).toBe(291);
  });

  it("stock overrides land on the re-expressed fork snapshot", () => {
    const trunk = run(trunkModel);
    const b = fork(trunk, 6, weeklyModel, { stocks: { fund: 1000 } });
    const forkSnap = b.snapshots.find((s) => s.t === 26)!;
    expect(forkSnap.stocks.fund).toBe(1000);
    expect(forkSnap.deltas).toEqual([{ stock: "fund", amount: 840, rule: "fork @t=26" }]);
    expect(b.snapshots.find((s) => s.t === 27)!.stocks.fund).toBe(1001);
    expect(trunk[6]!.stocks.fund).toBe(160); // the trunk is untouched
  });
});

describe("snapAtOrBefore", () => {
  const marks = [0, 13, 26].map((t) => ({ t, unit: "week" as const, stocks: {}, derived: {}, deltas: [] }));
  it("hits exactly, holds last between marks, clamps before the first", () => {
    expect(snapAtOrBefore(marks, 13)!.t).toBe(13);
    expect(snapAtOrBefore(marks, 14)!.t).toBe(13);
    expect(snapAtOrBefore(marks, 100)!.t).toBe(26);
    expect(snapAtOrBefore(marks, -5)!.t).toBe(0);
    expect(snapAtOrBefore([], 0)).toBeUndefined();
  });
});

describe("Δ-vs-trunk diff across a re-ticked fork", () => {
  it("aligns the trunk by duration, hold-last", () => {
    const trunkModel = model({
      horizon: { start: 0, end: 10, unit: "month" },
      stocks: { fund: 100 },
      rules: [flow("fund", 10, "deposit")],
    });
    const weeklyModel = model({
      horizon: { start: 0, end: 40, unit: "week" },
      stocks: { fund: 0 },
      rules: [flow("fund", 1, "weekly top-up")],
    });
    const trunk = run(trunkModel);
    const b = fork(trunk, 6, weeklyModel);
    const diff = formatDiff(trunk, b);
    // week 27: branch 161, trunk floor-aligned at month 6 = 160 → +1
    expect(diff).toMatch(/\n27\s+\+1\.00/);
    // week 34 (=238 days → month 7.85 → floor month 7 = 170): branch 168 → −2
    expect(diff).toMatch(/\n34\s+-2\.00/);
    // the sparse prefix (weeks 0 and 13) is not diffed
    expect(diff).not.toMatch(/\n13\s/);
    // rows run to week 40; the trunk's duration ends at week 43⅓ so nothing is "—"
    expect(diff).toMatch(/\n40\s/);
    expect(diff).not.toContain("—");
  });

  it("same-unit diffs are unchanged by the duration alignment", () => {
    const trunk = run(model({ horizon: { start: 0, end: 6, unit: "month" }, stocks: { a: 0 }, rules: [flow("a", 1, "step")] }));
    const boost = model({ horizon: { start: 0, end: 6, unit: "month" }, stocks: { a: 0 }, rules: [flow("a", 2, "double")] });
    const b = fork(trunk, 3, boost);
    const diff = formatDiff(trunk, b);
    expect(diff).toMatch(/\n4\s+\+1\.00/);
    expect(diff).toMatch(/\n6\s+\+3\.00/);
  });
});
