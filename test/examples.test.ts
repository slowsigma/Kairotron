import { describe, expect, it } from "vitest";
import { fork, run } from "../src/core/fold.js";
import epidemicSir from "../examples/epidemic-sir.js";
import retirement from "../examples/retirement.js";
import retirementBoost from "../examples/retirement-boost.js";
import reservoir from "../examples/reservoir.js";
import supplyChain from "../examples/supply-chain.js";

describe("retirement exemplar", () => {
  it("matches a hand-rolled monthly loop", () => {
    const history = run(retirement);
    let preTax = 120000;
    let cash = 25000;
    const i = 0.07 / 12;
    const j = 0.015 / 12;
    for (let t = 1; t <= 12; t++) {
      preTax = (preTax + 2750) * (1 + i);
      cash = cash * (1 + j);
      expect(history[t]!.stocks.preTax).toBeCloseTo(preTax, 8);
      expect(history[t]!.stocks.cash).toBeCloseTo(cash, 8);
    }
    expect(history[12]!.stocks.preTax).toBeCloseTo(162953, -2);
  });

  it("first tick deltas list contribution and growth on preTax", () => {
    const d = run(retirement)[1]!.deltas;
    expect(d.map((x) => x.rule)).toEqual([
      "monthly contribution",
      "growth @ 7%/year",
      "interest @ 1.5%/year",
    ]);
    expect(d[0]!.amount).toBeCloseTo(2750, 10);
  });

  it("re-ticks to years with rate re-normalization", () => {
    const yearly = run(retirement, { start: 0, end: 1, unit: "year" });
    // one annual tick: contribution applies once at full size, growth is 7%
    const expected = (120000 + 2750) * 1.07;
    expect(yearly[1]!.stocks.preTax).toBeCloseTo(expected, 8);
  });
});

describe("retirement what-if fork", () => {
  it("the boosted branch matches a hand-rolled loop from the fork tick on", () => {
    const trunk = run(retirement);
    const branch = fork(trunk, 6, retirementBoost, { label: "boost" });
    expect(branch.snapshots[6]).toBe(trunk[6]); // shared prefix — forking is free
    let preTax = trunk[6]!.stocks.preTax!;
    let cash = trunk[6]!.stocks.cash!;
    const i = 0.07 / 12;
    const j = 0.015 / 12;
    for (let t = 7; t <= 24; t++) {
      preTax = (preTax + 3500) * (1 + i);
      cash = cash * (1 + j);
      expect(branch.snapshots[t]!.stocks.preTax).toBeCloseTo(preTax, 8);
      expect(branch.snapshots[t]!.stocks.cash).toBeCloseTo(cash, 8);
    }
    // the raise compounds: strictly ahead, and the branch outlives the trunk
    expect(branch.snapshots[12]!.stocks.preTax!).toBeGreaterThan(trunk[12]!.stocks.preTax!);
    expect(trunk).toHaveLength(13); // the trunk horizon is untouched
    expect(branch.snapshots).toHaveLength(25);
  });
});

describe("reservoir exemplar", () => {
  it("matches a hand-rolled daily loop with monthly rates normalized per day", () => {
    const history = run(reservoir);
    let storage = 4000;
    const inflow = (180 * 12) / 364; // 52×7-day abstract year (units.ts)
    const release = (150 * 12) / 364;
    const evap = (0.025 * 12) / 364;
    for (let t = 1; t <= 60; t++) {
      storage += inflow - release;
      storage -= storage * evap;
      expect(history[t]!.stocks.storage).toBeCloseTo(storage, 8);
    }
    // evaporation outweighs the small net inflow: the dam drains
    expect(history[60]!.stocks.storage!).toBeLessThan(4000);
  });

  it("drains on the monthly tick too, but not by the same amount (tick unit is semantics)", () => {
    const monthly = run(reservoir, { start: 0, end: 2, unit: "month" });
    const expected1 = (4000 + 180 - 150) * (1 - 0.025);
    expect(monthly[1]!.stocks.storage).toBeCloseTo(expected1, 8);
  });

  it("all 61 snapshots exist and stay finite", () => {
    const history = run(reservoir);
    expect(history).toHaveLength(61);
    for (const s of history) expect(Number.isFinite(s.stocks.storage)).toBe(true);
  });
});

describe("supply-chain exemplar", () => {
  it("matches a hand-rolled loop with delta-of-lagged-stock deliveries", () => {
    const history = run(supplyChain);
    let inv = 150;
    let sold = 0;
    let supplier = 100000;
    const soldEnd = [0];
    for (let t = 1; t <= 24; t++) {
      const demand = Math.min(100, inv);
      inv -= demand;
      sold += demand;
      const del = soldEnd[Math.max(0, t - 2)]! - soldEnd[Math.max(0, t - 3)]!;
      inv += del;
      supplier -= del;
      soldEnd[t] = sold;
      const s = history[t]!;
      expect(s.stocks.inventory).toBeCloseTo(inv, 8);
      expect(s.stocks.sold).toBeCloseTo(sold, 8);
      expect(s.stocks.supplier).toBeCloseTo(supplier, 8);
    }
  });

  it("rings with period 3 and under-serves demand (bullwhip from the 2-week lag)", () => {
    const history = run(supplyChain);
    for (let t = 4; t <= 21; t++) {
      expect(history[t]!.stocks.inventory).toBeCloseTo(history[t + 3]!.stocks.inventory, 10);
    }
    expect(history[24]!.stocks.sold!).toBeLessThan(100 * 24);
  });

  it("conserves units across supplier, inventory and sold", () => {
    for (const s of run(supplyChain)) {
      expect(s.stocks.supplier! + s.stocks.inventory! + s.stocks.sold!).toBeCloseTo(100150, 8);
    }
  });
});

describe("epidemic SIR exemplar", () => {
  const history = run(epidemicSir);

  it("conserves the population at every tick", () => {
    for (const s of history) {
      expect(s.stocks.susceptible! + s.stocks.infected! + s.stocks.recovered!).toBeCloseTo(10000, 8);
    }
  });

  it("the epidemic takes off and recoveries accumulate", () => {
    expect(Math.max(...history.map((s) => s.stocks.infected))).toBeGreaterThan(800);
    expect(history[40]!.stocks.recovered).toBeGreaterThan(100);
    for (let t = 1; t <= 40; t++) {
      expect(history[t]!.stocks.susceptible).toBeLessThanOrEqual(history[t - 1]!.stocks.susceptible);
    }
  });

  it("the weekly vaccination campaign runs on days 7,14,21,28,35 and not in between", () => {
    const jabbed = history
      .filter((s) => s.deltas.some((d) => d.rule === "weekly vaccination"))
      .map((s) => s.t);
    expect(jabbed).toEqual([7, 14, 21, 28, 35]);
  });
});

describe("derived quantities on the exemplars", () => {
  it("retirement: netWorth sums the stocks; share stays in [0,1]", () => {
    for (const s of run(retirement)) {
      expect(s.derived.netWorth).toBeCloseTo(s.stocks.preTax! + s.stocks.cash!, 8);
      expect(s.derived.preTaxShare).toBeGreaterThanOrEqual(0);
      expect(s.derived.preTaxShare).toBeLessThanOrEqual(1);
    }
  });

  it("reservoir: fill fraction tracks capacity", () => {
    for (const s of run(reservoir)) {
      expect(s.derived.fillFraction).toBeCloseTo(s.stocks.storage! / 5000, 10);
    }
  });

  it("supply-chain: weeks of cover and cumulative fill ratio", () => {
    const history = run(supplyChain);
    for (const s of history) {
      expect(s.derived.weeksCover).toBeCloseTo(s.stocks.inventory! / 100, 10);
    }
    expect(history[0]!.derived.fillRatio).toBe(0);
    expect(history[24]!.derived.fillRatio).toBeCloseTo(history[24]!.stocks.sold! / 2400, 10);
  });

  it("epidemic SIR: percentages chain off earlier derivations", () => {
    for (const s of run(epidemicSir)) {
      expect(s.derived.infectedPercent).toBeCloseTo((100 * s.stocks.infected!) / 10000, 10);
      expect(s.derived.curedPlusSickPercent).toBeCloseTo(
        s.derived.attackPercent! + s.derived.infectedPercent!,
        10,
      );
    }
  });
});
