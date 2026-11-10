import { derived, flow, model, pct, rate } from "../src/dsl/model.js";

// What-if variant of retirement.ts that re-ticks the fold from monthly to
// daily ticks (milestone 6: tick re-normalization), run with:
//   npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
//     --variant examples/retirement-daily.ts --diff
//
// The trunk's first 182 days (6 monthly ticks land on whole days at 3-month
// boundaries) are re-expressed on the daily scale — sparse in the shared
// prefix, exact by duration. Contribution and yields are declared as rates
// and re-normalize to the day tick; the daily 364-tick horizon spans the
// same year as the trunk's 12 monthly ticks.
export default model({
  horizon: { start: 0, end: 364, unit: "day" },
  constants: {
    contribution: rate(2750, "month"),
    growth: pct(7, "year"),
    cashYield: pct(1.5, "year"),
  },
  stocks: {
    preTax: 0,
    cash: 0,
  },
  rules: [
    flow("preTax", (c) => c.perTick("contribution"), "daily contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year"),
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash),
    derived("preTaxShare", (c) => c.stocks.preTax / (c.stocks.preTax + c.stocks.cash)),
  ],
});
