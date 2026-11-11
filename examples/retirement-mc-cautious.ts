import { derived, flow, model, pct, transfer, stochastic, normal } from "../src/dsl/model.js";

// Same-world what-if for retirement-mc.ts, run with:
//   npx tsx src/cli.ts examples/retirement-mc.ts --mc 500 --seed 1 \
//     --fork-at 120 --variant examples/retirement-mc-cautious.ts
//
// From the fork tick on, a cautious sweep moves 10% of the pre-tax pot to
// cash monthly — trading expected growth for a floor under the bad tail.
// Each forked path continues its trunk path's own shock sequence (the fold
// replays the prefix's draws), so trunk-vs-branch percentile bands isolate
// the decision's effect with the noise held fixed.
export default model({
  horizon: { start: 0, end: 240, unit: "month" },
  constants: {
    contribution: 2750,
    growth: stochastic(pct(7, "year"), normal(pct(15, "year"))),
    cashYield: pct(1.5, "year"),
    deRisk: 0.1,
  },
  stocks: {
    preTax: 0,
    cash: 0,
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year (stochastic)"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year"),
    transfer("preTax", "cash", (c) => c.stocks.preTax * c.constants.deRisk, "de-risk sweep"),
  ],
  derived: [derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash)],
});
