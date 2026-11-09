import { derived, flow, model, pct } from "../src/dsl/model.js";

// What-if variant of retirement.ts, run with:
//   npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
//     --variant examples/retirement-boost.ts --diff
//
// From the fork tick on, a raise lifts the contribution 2750 -> 3500 and the
// horizon stretches 12 -> 24 months; the state at t=6 is inherited from the
// trunk for free because snapshots never mutate.
export default model({
  horizon: { start: 0, end: 24, unit: "month" },
  constants: {
    contribution: 3500,
    growth: pct(7, "year"),
    cashYield: pct(1.5, "year"),
  },
  stocks: {
    preTax: 0,
    cash: 0,
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution (boosted)"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year"),
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash),
    derived("preTaxShare", (c) => c.stocks.preTax / (c.stocks.preTax + c.stocks.cash)),
  ],
});
