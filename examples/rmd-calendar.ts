import type { CalendarDate } from "../src/core/types.js";
import { date, derived, flow, model, pct, when } from "../src/dsl/model.js";

// Date-gated retirement (milestone 7): the fold itself is an abstract monthly
// stock-and-flow, but declaring horizon.basis = the account holder's birth
// date gives every tick a civil moment. Gates read c.date() — the plan.md
// `age >= 73 -> rmd` idiom — and tables/axes render in calendar terms.
// Engine semantics stay tick-pure: dates never enter the state.
const BIRTH = date("1975-06-15");

// Age at the current tick: whole years since birth, with the 15-June
// birthday treated as passed on/after that civil day.
const ageYears = (ctx: { date(t?: number): CalendarDate }): number => {
  const d = ctx.date();
  const birthdayPassed = d.month > 6 || (d.month === 6 && d.day >= 15);
  return d.year - 1975 - (birthdayPassed ? 0 : 1);
};

export default model({
  horizon: { start: 0, end: 1000, unit: "month", convention: "actual/365", basis: BIRTH },
  constants: {
    growth: pct(6, "year"),
    monthlySave: 500,
    annualRmd: 9000,
  },
  stocks: { ira: 50000, cash: 0 },
  rules: [
    flow("ira", (c) => c.stocks.ira * c.perTick("growth"), "growth @ 6%/year"),
    when((c) => ageYears(c) < 65, flow("ira", (c) => c.constants.monthlySave, "contribution")),
    when(
      (c) => ageYears(c) >= 73,
      flow("cash", (c) => c.constants.annualRmd / 12, "required minimum distribution"),
    ),
  ],
  derived: [
    derived("age", (c) => ageYears(c)),
    derived("netWorth", (c) => c.stocks.ira + c.stocks.cash),
  ],
});
