import { describe, expect, it } from "vitest";
import { run, runPathRange } from "../src/core/fold.js";
import { DEFAULT_MC_SEED, forkMonteCarlo, runPaths, type MonteCarloResult } from "../src/core/mc.js";
import { pathSeed, Rng } from "../src/core/random.js";
import { derived, flow, model, normal, pct, stochastic, uniform } from "../src/dsl/model.js";
import {
  DEFAULT_PERCENTILES,
  formatPercentileCsv,
  formatPercentileTable,
  percentile,
  summarizeMonteCarlo,
  type PercentileSummary,
} from "../src/outputs/table.js";
import retirementMc from "../examples/retirement-mc.js";
import retirementMcCautious from "../examples/retirement-mc-cautious.js";

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const finals = (mc: MonteCarloResult): number[] =>
  mc.timelines.map((h) => h[h.length - 1]!.stocks.fund!);

describe("seeded PRNG", () => {
  it("is reproducible per seed and distinct across seeds", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const c = new Rng(124);
    const sa = Array.from({ length: 8 }, () => a.normal());
    const sb = Array.from({ length: 8 }, () => b.normal());
    const sc = Array.from({ length: 8 }, () => c.normal());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it("uniform is in [0,1) with the right first moments; normal is ~standard", () => {
    const u = new Rng(7);
    const us = Array.from({ length: 20000 }, () => u.uniform());
    for (const x of us) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mean(us)).toBeCloseTo(0.5, 2);
    const n = new Rng(7);
    const ns = Array.from({ length: 20000 }, () => n.normal());
    expect(mean(ns)).toBeCloseTo(0, 2);
    const sd = Math.sqrt(mean(ns.map((x) => x * x)));
    expect(sd).toBeCloseTo(1, 2);
  });

  it("path streams never coincide and re-slicing a range never renumbers them", () => {
    const s = 42;
    const v = (p: number) => new Rng(pathSeed(s, p)).uniform();
    expect(v(0)).not.toBe(v(1));
    expect(v(3)).not.toBe(v(4));
    // A path's stream is fixed by (master seed, path index), so slicing the
    // range for a worker pool never renumbers or re-draws any path.
    const m = model({
      horizon: { start: 0, end: 2, unit: "year" },
      constants: { g: stochastic(pct(0, "year"), normal(pct(100, "year"))) },
      stocks: { fund: 1 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    });
    const full = runPaths(m, { paths: 5, seed: s });
    const slice = runPathRange(m, { seed: s, from: 2, to: 4 });
    expect(slice[0]![2]!.stocks.fund).toBe(full.timelines[2]![2]!.stocks.fund);
    expect(slice[1]![2]!.stocks.fund).toBe(full.timelines[3]![2]!.stocks.fund);
  });
});

describe("stochastic() validation", () => {
  it("rejects bad distributions", () => {
    expect(() => normal(pct(-1, "year"))).toThrow(/non-negative/);
    expect(() => normal(0.15 as never)).toThrow(/rate volatility/);
    expect(() => uniform(pct(9, "year"), pct(2, "year"))).toThrow(/low <= high/);
    expect(() => uniform(pct(2, "year"), pct(9, "month"))).toThrow(/same per-unit/);
    expect(() => stochastic(42 as never, normal(pct(15, "year")))).toThrow(/rate base/);
    expect(() =>
      stochastic(pct(7, "year"), { kind: "cauchy", sd: pct(1, "year") } as never),
    ).toThrow(/normal\(\.\.\.\) or uniform\(\.\.\.\)/);
  });
});

describe("deterministic default (stochastic models under a plain run)", () => {
  it("reads a normal constant at its base rate — identical to the plain model", () => {
    const noisey = model({
      horizon: { start: 0, end: 24, unit: "month" },
      constants: { growth: stochastic(pct(7, "year"), normal(pct(40, "year"))) },
      stocks: { fund: 1000 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
    });
    const plain = model({
      horizon: { start: 0, end: 24, unit: "month" },
      constants: { growth: pct(7, "year") },
      stocks: { fund: 1000 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
    });
    expect(run(noisey).map((s) => s.stocks.fund)).toEqual(run(plain).map((s) => s.stocks.fund));
  });

  it("reads a uniform constant at the band midpoint", () => {
    const m = model({
      horizon: { start: 0, end: 1, unit: "year" },
      constants: { g: stochastic(pct(0, "year"), uniform(pct(2, "year"), pct(9, "year"))) },
      stocks: { fund: 100 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    });
    expect(run(m)[1]!.stocks.fund).toBeCloseTo(105.5, 10);
  });
});

describe("runPaths", () => {
  const model0 = model({
    horizon: { start: 0, end: 40, unit: "year" },
    constants: { growth: stochastic(pct(6, "year"), normal(pct(18, "year"))) },
    stocks: { fund: 1000 },
    rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
  });

  it("same seed reproduces every path; a different seed does not", () => {
    const a = runPaths(model0, { paths: 12, seed: 5 });
    const b = runPaths(model0, { paths: 12, seed: 5 });
    const c = runPaths(model0, { paths: 12, seed: 6 });
    expect(JSON.stringify(a.timelines)).toBe(JSON.stringify(b.timelines));
    expect(finals(a)).not.toEqual(finals(c));
    expect(a.seed).toBe(5);
    expect(b.seed).toBe(5);
    expect(runPaths(model0, { paths: 3 }).seed).toBe(DEFAULT_MC_SEED);
  });

  it("a deterministic model collapses to one value at every percentile", () => {
    const plain = model({
      horizon: { start: 0, end: 6, unit: "month" },
      constants: { growth: pct(7, "year") },
      stocks: { fund: 100 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
    });
    const mc = runPaths(plain, { paths: 7, seed: 2 });
    const summary = summarizeMonteCarlo(mc);
    const det = run(plain)[6]!.stocks.fund!;
    for (const l of summary.labels) expect(summary.rows[6]!.stocks.fund![l]!).toBeCloseTo(det, 12);
  });

  it("validates paths and seed", () => {
    expect(() => runPaths(model0, { paths: 0 })).toThrow(/whole number >= 1/);
    expect(() => runPaths(model0, { paths: 1.5 })).toThrow(/whole number >= 1/);
    expect(() => runPaths(model0, { paths: 3, seed: 0.5 })).toThrow(/seed must be an integer/);
  });
});

describe("Monte Carlo statistics (seeded, so tolerances are stable)", () => {
  it("normal noise is mean-preserving: the path mean matches the expected-value run", () => {
    const m = model({
      horizon: { start: 0, end: 10, unit: "year" },
      constants: { growth: stochastic(pct(0, "year"), normal(pct(20, "year"))) },
      stocks: { fund: 1000 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
    });
    const mc = runPaths(m, { paths: 5000, seed: 42 });
    const expected = run(m)[10]!.stocks.fund!; // = 1000 exactly: mean-preserving
    expect(expected).toBe(1000);
    expect(Math.abs(mean(finals(mc)) - 1000)).toBeLessThan(40);
    const s = summarizeMonteCarlo(mc, [10, 25, 50, 75, 90]).rows[10]!.stocks.fund!;
    expect(s.p10).toBeLessThan(s.p25);
    expect(s.p25).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p75);
    expect(s.p75).toBeLessThan(s.p90);
    // multiplicative noise compounds log-normally: the median sits below the mean
    expect(s.p50).toBeLessThan(mean(finals(mc)));
  });

  it("volatility is tick-unit invariant (sqrt-time scaling, not linear)", () => {
    const maker = (unit: "year" | "month", ticks: number) =>
      model({
        horizon: { start: 0, end: ticks, unit },
        constants: { growth: stochastic(pct(0, "year"), normal(pct(20, "year"))) },
        stocks: { fund: 1000 },
        rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
      });
    // E[s_T^2] / E[s_T]^2 = (1 + sigma^2)^years for per-tick mean-zero shocks —
    // 1.4802 over 10 years whether folded yearly (10 ticks) or monthly (120).
    // Linear sd scaling would give the monthly grid 1.0407 — far outside this
    // band. (Estimator noise is ~6% at 5000 paths; 12% is a safe frame.)
    const rel2 = (f: readonly number[]): number => mean(f.map((x) => x * x)) / mean(f) ** 2;
    const yearly = rel2(finals(runPaths(maker("year", 10), { paths: 5000, seed: 9 })));
    const monthly = rel2(finals(runPaths(maker("month", 120), { paths: 5000, seed: 9 })));
    expect(Math.abs(yearly - 1.4802) / 1.4802).toBeLessThan(0.12);
    expect(Math.abs(monthly - 1.4802) / 1.4802).toBeLessThan(0.12);
    // The two grids must also agree with *each other* — this is the tick-unit
    // invariance itself: linear sd scaling would put them 30% apart.
    expect(Math.abs(monthly - yearly) / yearly).toBeLessThan(0.12);
  });

  it("uniform noise is tick-unit invariant (sqrt-time width scaling)", () => {
    const maker = (unit: "year" | "month", ticks: number) =>
      model({
        horizon: { start: 0, end: ticks, unit },
        constants: {
          g: stochastic(pct(0, "year"), uniform(pct(-10, "year"), pct(10, "year"))),
        },
        stocks: { fund: 1 },
        rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
      });
    const rel2 = (f: readonly number[]): number => mean(f.map((x) => x * x)) / mean(f) ** 2;
    const yearly = rel2(finals(runPaths(maker("year", 10), { paths: 10000, seed: 21 })));
    const monthly = rel2(finals(runPaths(maker("month", 120), { paths: 10000, seed: 21 })));
    // U[−0.1, 0.1] per year: E[(1+r)^2] = 1 + 0.01/3 per year, ^10 ≈ 1.0339.
    // Linear per-tick bounds would leave the monthly grid near 1.003.
    expect(Math.abs(yearly - 1.0339) / 1.0339).toBeLessThan(0.12);
    expect(Math.abs(monthly - yearly) / yearly).toBeLessThan(0.12);
  });

  it("uniform noise stays in its band and is mean-preserving", () => {
    const m = model({
      horizon: { start: 0, end: 100, unit: "year" },
      constants: { g: stochastic(pct(0, "year"), uniform(pct(-10, "year"), pct(10, "year"))) },
      stocks: { fund: 1 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    });
    const mc = runPaths(m, { paths: 5000, seed: 12 });
    expect(Math.abs(mean(finals(mc)) - 1)).toBeLessThan(0.12); // E = prod E[1+r] = 1
    const lo = (0.9 as number) ** 100;
    const hi = (1.1 as number) ** 100;
    for (const f of finals(mc)) {
      expect(f).toBeGreaterThanOrEqual(lo);
      expect(f).toBeLessThanOrEqual(hi);
    }
    const p50 = summarizeMonteCarlo(mc).rows[100]!.stocks.fund!.p50!;
    expect(p50).toBeGreaterThan(0.75);
    expect(p50).toBeLessThan(0.95); // ~e^(100·E[ln(1+u)]) ≈ 0.843
  });
});

describe("forkMonteCarlo (same-world what-ifs)", () => {
  const trunk = model({
    horizon: { start: 0, end: 10, unit: "year" },
    constants: { growth: stochastic(pct(6, "year"), normal(pct(18, "year"))) },
    stocks: { fund: 1000 },
    rules: [flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth")],
  });

  it("an unchanged variant replays the trunk pathwise — the prefix is shared by reference", () => {
    const mc = runPaths(trunk, { paths: 16, seed: 3 });
    const branch = forkMonteCarlo(mc, 5, trunk, {});
    expect(branch.paths).toBe(16);
    expect(branch.seed).toBe(3); // inherits the trunk seed by default
    for (let p = 0; p < 16; p++) {
      expect(branch.timelines[p]![10]!.stocks.fund).toBe(mc.timelines[p]![10]!.stocks.fund);
      expect(branch.timelines[p]![3]).toBe(mc.timelines[p]![3]); // shared snapshot objects
    }
  });

  it("rejects a different seed: a branch must continue the trunk's world", () => {
    const mc = runPaths(trunk, { paths: 4, seed: 3 });
    expect(() => forkMonteCarlo(mc, 5, trunk, { seed: 4 })).toThrow(/continues the trunk's world/);
    expect(() => forkMonteCarlo(mc, 5, trunk, { seed: 3 })).not.toThrow();
  });

  it("rejects a re-ticked branch instead of silently mixing worlds", () => {
    const mc = runPaths(trunk, { paths: 4, seed: 3 });
    expect(() =>
      forkMonteCarlo(mc, 5, trunk, { horizon: { start: 0, end: 120, unit: "month" } }),
    ).toThrow(/keep the trunk's tick grid/);
    expect(() =>
      forkMonteCarlo(mc, 5, trunk, {
        horizon: { start: 0, end: 10, unit: "year", convention: "actual/365" },
      }),
    ).toThrow(/keep the trunk's tick grid/);
  });

  it("a changed variant shares the prefix but diverges after the fork", () => {
    const mc = runPaths(trunk, { paths: 8, seed: 3 });
    const variant = model({
      horizon: { start: 0, end: 10, unit: "year" },
      constants: { growth: stochastic(pct(6, "year"), normal(pct(18, "year"))) },
      stocks: { fund: 0 },
      rules: [
        flow("fund", (c) => c.stocks.fund * c.perTick("growth"), "growth"),
        flow("fund", 50, "extra"),
      ],
    });
    const branch = forkMonteCarlo(mc, 4, variant, {});
    expect(branch.timelines[0]![4]).toBe(mc.timelines[0]![4]);
    const diffs = branch.timelines.map(
      (h, p) => h[10]!.stocks.fund! - mc.timelines[p]![10]!.stocks.fund!,
    );
    for (const d of diffs) expect(d).toBeGreaterThan(0); // +50/yr for 6 years, always
  });
});

describe("percentile summarization", () => {
  it("percentile() interpolates between closest ranks (R-7)", () => {
    const xs = [1, 2, 3, 4];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 50)).toBeCloseTo(2.5, 10);
    expect(percentile(xs, 25)).toBeCloseTo(1.75, 10);
    expect(percentile(xs, 100)).toBe(4);
    expect(percentile([7], 37)).toBe(7);
  });

  it("summarizeMonteCarlo defaults to p10/p50/p90 and counts paths", () => {
    const m = model({
      horizon: { start: 0, end: 3, unit: "year" },
      constants: { g: stochastic(pct(5, "year"), normal(pct(30, "year"))) },
      stocks: { fund: 100 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
      derived: [],
    });
    const mc = runPaths(m, { paths: 60, seed: 8 });
    const summary = summarizeMonteCarlo(mc);
    expect(summary.percentiles).toEqual(DEFAULT_PERCENTILES);
    expect(summary.labels).toEqual(["p10", "p50", "p90"]);
    expect(summary.rows).toHaveLength(4);
    expect(summary.rows[0]!.count).toBe(60);
    expect(summary.rows[0]!.stocks.fund!.p10).toBe(100);
    expect(summary.rows[0]!.stocks.fund!.p90).toBe(100);
  });

  it("carries the calendar basis through to the rows", () => {
    const m = model({
      horizon: { start: 0, end: 2, unit: "month", convention: "actual/365", basis: Date.UTC(2026, 0, 1) },
      constants: { g: stochastic(pct(6, "year"), normal(pct(20, "year"))) },
      stocks: { fund: 1 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    });
    const summary = summarizeMonteCarlo(runPaths(m, { paths: 5, seed: 1 }));
    expect(summary.rows[1]!.basis).toBe(Date.UTC(2026, 0, 1));
    const table = formatPercentileTable(summary);
    expect(table).toContain("date");
    expect(table).toContain("2026-02-01");
  });

  it("rejects mismatched path grids and bad percentile specs", () => {
    const m = model({
      horizon: { start: 0, end: 2, unit: "year" },
      constants: { g: stochastic(pct(5, "year"), normal(pct(30, "year"))) },
      stocks: { fund: 1 },
      rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    });
    const mc = runPaths(m, { paths: 2, seed: 1 }) as MonteCarloResult;
    const broken = { ...mc, timelines: [mc.timelines[0]!, mc.timelines[0]!.slice(0, 2)] };
    expect(() => summarizeMonteCarlo(broken)).toThrow(/share the tick grid/);
    expect(() => summarizeMonteCarlo(mc, [])).toThrow(/at least one percentile/);
    expect(() => summarizeMonteCarlo(mc, [101])).toThrow(/within 0\.\.100/);
  });

  it("renders aligned tables and CSV with one column per stock × percentile", () => {
    const table = formatPercentileTable(makeSummary());
    const header = table.split("\n")[0]!;
    expect(header).toContain("fund·p10");
    expect(header).toContain("fund·p50");
    expect(header).toContain("~w·p50");
    const csv = formatPercentileCsv(makeSummary());
    const [line0, lineT0, lineT1] = csv.split("\n");
    expect(line0).toBe("t,fund·p10,fund·p50,~w·p10,~w·p50");
    // t=0 collapses every percentile to the initial state…
    expect(lineT0!.split(",")).toEqual(["0", "100", "100", "200", "200"]);
    // …and at t=1 the band is open, raw numbers, w exactly 2·fund.
    const cells = lineT1!.split(",");
    expect(cells).toHaveLength(5);
    expect(lineT1).not.toContain('"');
    expect(Number(cells[1])).toBeLessThan(Number(cells[2])); // p10 < p50
    expect(Number(cells[3])).toBeCloseTo(2 * Number(cells[1]), 6);
  });

  it("exposes percentiles in a table next to the fold semantics (netWorth = sum)", () => {
    const summary = makeSummary();
    const row = summary.rows[1]!;
    expect(row.stocks.fund!.p50).toBeGreaterThan(row.stocks.fund!.p10!);
  });
});

function makeSummary(): PercentileSummary {
  const m = model({
    horizon: { start: 0, end: 1, unit: "year" },
    constants: { g: stochastic(pct(5, "year"), normal(pct(30, "year"))) },
    stocks: { fund: 100 },
    rules: [flow("fund", (c) => c.stocks.fund * c.perTick("g"), "g")],
    derived: [derived("w", (c) => 2 * c.stocks.fund)],
  });
  return summarizeMonteCarlo(runPaths(m, { paths: 40, seed: 3 }), [10, 50]);
}

describe("retirement Monte Carlo exemplar", () => {
  it("the deterministic run matches a hand-rolled expected-value loop", () => {
    const history = run(retirementMc);
    let preTax = 120000;
    let cash = 25000;
    const i = 0.07 / 12;
    const j = 0.015 / 12;
    for (let t = 1; t <= 240; t++) {
      preTax = (preTax + 2750) * (1 + i);
      cash = cash * (1 + j);
      // 240 folded multiplications: normalizeRate's (364/12)/364 chain and the
      // hand-rolled /12 diverge at the float-noise level, so 6 digits not 8.
      expect(history[t]!.stocks.preTax).toBeCloseTo(preTax, 6);
      expect(history[t]!.stocks.cash).toBeCloseTo(cash, 6);
    }
  });

  it("percentile bands widen with the horizon and the mean tracks the expected value", () => {
    const mc = runPaths(retirementMc, { paths: 1000, seed: 11 });
    const summary = summarizeMonteCarlo(mc, [10, 50, 90]);
    const det = run(retirementMc);
    const width = (t: number): number =>
      summary.rows[t]!.derived.netWorth!.p90! - summary.rows[t]!.derived.netWorth!.p10!;
    expect(width(240)).toBeGreaterThan(width(12) * 3); // vol accrues roughly sqrt-time
    const pathMean = mean(mc.timelines.map((h) => h[240]!.derived.netWorth!));
    // mean-preserving noise: E[netWorth] equals the expected-value fold
    expect(Math.abs(pathMean - det[240]!.derived.netWorth!) / det[240]!.derived.netWorth!).toBeLessThan(0.05);
  });

  it("same-world de-risking compresses the distribution: lifts the floor, caps the upside", () => {
    const mc = runPaths(retirementMc, { paths: 1000, seed: 13 });
    const branch = forkMonteCarlo(mc, 120, retirementMcCautious, {});
    const cols = [0, 10, 50, 90, 100];
    const trunkS = summarizeMonteCarlo(mc, cols).rows[240]!.derived.netWorth!;
    const branchS = summarizeMonteCarlo(branch, cols).rows[240]!.derived.netWorth!;
    // Every path faces its trunk path's exact shocks (same-world fork), so the
    // whole band shift is the sweep's: cash at 1.5% floors the worst outcome,
    // trims the median, and caps the best one.
    expect(branchS.p0).toBeGreaterThan(trunkS.p0);
    expect(branchS.p100).toBeLessThan(trunkS.p100);
    expect(branchS.p50).toBeLessThan(trunkS.p50); // risk, not free
    const width = (s: Record<string, number>) => s.p90! - s.p10!;
    expect(width(branchS)).toBeLessThan(width(trunkS) / 2);
  });
});
