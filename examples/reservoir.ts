import { flow, model, pct, rate } from "../src/dsl/model.js";

// Reservoir in ML (megalitres), daily ticks. Rates are declared in monthly
// terms and normalized to the daily tick by the engine (2160 ML/year in,
// 1800 out, proportional evaporation).
export default model({
  horizon: { start: 0, end: 60, unit: "day" },
  constants: {
    inflow: rate(180, "month"),
    release: rate(150, "month"),
    evap: pct(2.5, "month"),
  },
  stocks: {
    storage: 4000,
  },
  rules: [
    flow("storage", (c) => c.perTick("inflow"), "catchment inflow"),
    flow("storage", (c) => -c.perTick("release"), "controlled release"),
    flow("storage", (c) => -c.stocks.storage * c.perTick("evap"), "evaporation"),
  ],
});
