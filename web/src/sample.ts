export const SAMPLE = `// Kairotron — edit and Run (Ctrl+Enter).
// A model is model({ horizon, constants, stocks, rules, derived }).
// Constants may be plain numbers or rates; rules read plain numbers via
// c.constants and rates (re-normalized to the tick unit) via c.perTick.
// horizon.basis = date("...") anchors tick 0 to a civil date: display and
// axis labels go through it (gates can read it via c.date() / c.when(t)).
// rules/derived also accept mini()/miniDerived() sugar — the mini-notation
// analog: terse statements whose provenance highlights just the same.
model({
  horizon: { start: 0, end: 40, unit: "year", convention: "actual/365", basis: date("2026-01-01") },
  constants: {
    contribution: rate(4000, "year"),
    growth: pct(6.5, "year"),
    salaryDivert: rate(1200, "year"),
    cashYield: pct(1.5, "year"),
  },
  stocks: { preTax: 40000, cash: 8000 },
  rules: mini(\`
    when t <= 25: preTax += contribution             "contribution"
    preTax += preTax * growth                        "growth"
    cash   += salaryDivert                           "salary divert"
    cash   += cash * cashYield                       "interest"
    cash   -> preTax: cash * 0.1                     "annual top-up"
  \`),
  derived: miniDerived(\`
    ~netWorth    = preTax + cash
    ~preTaxShare = preTax / netWorth
  \`),
})
`;
