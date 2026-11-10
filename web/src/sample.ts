export const SAMPLE = `// Kairotron — edit and Run (Ctrl+Enter).
// A model is model({ horizon, constants, stocks, rules, derived }).
// Constants may be plain numbers or rates; rules read plain numbers via
// c.constants and rates (re-normalized to the tick unit) via c.perTick.
// horizon.basis = date("...") anchors tick 0 to a civil date: display and
// axis labels go through it (gates can read it via c.date() / when(t, unit, basis)).
model({
  horizon: { start: 0, end: 40, unit: "year", convention: "actual/365", basis: date("2026-01-01") },
  constants: {
    contribution: rate(4000, "year"),
    growth: pct(6.5, "year"),
    salaryDivert: rate(1200, "year"),
    cashYield: pct(1.5, "year"),
  },
  stocks: { preTax: 40000, cash: 8000 },
  rules: [
    flow("preTax", (c) => c.perTick("contribution"), "contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth"),
    flow("cash", (c) => c.perTick("salaryDivert"), "salary divert"),
    flow("cash", (c) => c.stocks.cash * c.perTick("cashYield"), "interest"),
    transfer("cash", "preTax", (c) => c.stocks.cash * 0.1, "annual top-up"),
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash),
    derived("preTaxShare", (c) => c.stocks.preTax / (c.stocks.preTax + c.stocks.cash)),
  ],
})
`;
