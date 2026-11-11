import { derived, flow, model, pct, stochastic, normal } from "../src/dsl/model.js";

// Monte Carlo version of the retirement exemplar: the same monthly fold, but
// growth is a random sequence — 7%/year expected with 15%/year volatility.
// The noise is scaled to the tick by sqrt(tick/perUnit), so the outcome
// spread does not depend on the tick unit, and a deterministic run (no seed)
// is exactly the expected-value path: the same numbers as retirement.ts.
//
//   npx tsx src/cli.ts examples/retirement-mc.ts --mc 500 --seed 1
export default model({
  horizon: { start: 0, end: 240, unit: "month" },
  constants: {
    contribution: 2750,
    growth: stochastic(pct(7, "year"), normal(pct(15, "year"))),
    cashYield: pct(1.5, "year"),
  },
  stocks: {
    preTax: 120000,
    cash: 25000,
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year (stochastic)"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year"),
  ],
  derived: [derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash)],
});
