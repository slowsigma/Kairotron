import { derived, flow, model, pct } from "../src/dsl/model.js";

// Monthly retirement savings fold: fixed contribution into a growing
// pre-tax pot, cash sitting on a lower yield. 12 monthly ticks = 1 year.
export default model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: {
    contribution: 2750,
    growth: pct(7, "year"),
    cashYield: pct(1.5, "year"),
  },
  stocks: {
    preTax: 120000,
    cash: 25000,
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year"),
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash),
    derived("preTaxShare", (c) => c.stocks.preTax / (c.stocks.preTax + c.stocks.cash)),
  ],
});
