import { derived, every, model, pct, rate, transfer, when } from "../src/dsl/model.js";

// Daily SIR epidemic. Standard infection/recovery flows, plus a recurring
// vaccination campaign (every 7th day) that only runs while there are still
// susceptibles to inoculate (state guard).
const N = 10000;

export default model({
  horizon: { start: 0, end: 40, unit: "day" },
  constants: {
    contact: pct(35, "day"),
    recovery: rate(1 / 6, "day"),
    jabs: 100,
  },
  stocks: {
    susceptible: 9900,
    infected: 100,
    recovered: 0,
  },
  rules: [
    transfer(
      "susceptible",
      "infected",
      (c) => c.perTick("contact") * (c.stocks.susceptible / N) * c.stocks.infected,
      "new infections",
    ),
    transfer("infected", "recovered", (c) => c.stocks.infected * c.perTick("recovery"), "recoveries"),
    when(
      (c) => c.stocks.susceptible >= c.constants.jabs,
      every(7, transfer("susceptible", "recovered", (c) => c.constants.jabs, "weekly vaccination")),
    ),
  ],
  derived: [
    derived("infectedPercent", (c) => (100 * c.stocks.infected) / N),
    derived("attackPercent", (c) => (100 * c.stocks.recovered) / N),
    derived("curedPlusSickPercent", (c) => c.derived.attackPercent + c.derived.infectedPercent),
  ],
});
