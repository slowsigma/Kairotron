import { mini, miniDerived } from "../src/dsl/mini.js";
import { model, pct } from "../src/dsl/model.js";

// The same retirement cashflow as retirement.ts, written in the sugar (the
// mini-notation analog): terse statements transpile to the exact same
// flow()/derived() rules — same fold, same provenance. `k` magnitudes,
// '%' percent, rate names read per tick, guards and schedules as prefixes.
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
  rules: mini(`
    preTax += contribution       "monthly contribution"
    preTax += preTax * growth    "growth @ 7%/year"
    cash   += cash * cashYield   "interest @ 1.5%/year"
  `),
  derived: miniDerived(`
    ~netWorth = preTax + cash
    ~preTaxShare = preTax / netWorth
  `),
});
