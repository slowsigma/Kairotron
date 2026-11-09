import { derived, laggedDelta, model, transfer } from "../src/dsl/model.js";

// Weekly order-fulfillment pipeline with an information delay: the supplier
// ships what actually sold *last week*, as known on two-week-old books —
// the delta of the `sold` stock read two ticks back. The lag makes supply
// ring against demand (a bullwhip), leaving part of demand unserved.
export default model({
  horizon: { start: 0, end: 24, unit: "week" },
  constants: {
    demand: 100,
  },
  stocks: {
    supplier: 100000,
    inventory: 150,
    sold: 0,
  },
  rules: [
    transfer("inventory", "sold", (c) => Math.min(c.constants.demand, c.stocks.inventory), "customer demand"),
    transfer("supplier", "inventory", laggedDelta("sold", 2), "shipping last week's sales (2-week-old books)"),
  ],
  derived: [
    derived("weeksCover", (c) => c.stocks.inventory / c.constants.demand),
    derived("fillRatio", (c) => (c.t === 0 ? 0 : c.stocks.sold / (c.constants.demand * c.t))),
  ],
});
