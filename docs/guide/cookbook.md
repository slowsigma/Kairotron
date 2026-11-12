# Cookbook

Domain-neutral patterns, each a runnable model. The `ts run` blocks are
extracted and executed in CI; the full exemplars in `examples/` are each
verified tick-by-tick against hand-rolled loops in the test suite.

## Compound growth (the hello world)

```ts run
import { derived, flow, formatTable, model, pct, run } from "kairotron";

const compound = model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: { contribution: 2750, growth: pct(7, "year") },
  stocks: { pot: 120000 },
  rules: [
    flow("pot", (c) => c.constants.contribution, "contribution"),
    flow("pot", (c) => c.stocks.pot * c.perTick("growth"), "growth @ 7%/year"),
  ],
  derived: [derived("growthPerTick", (c) => c.perTick("growth"))],
});

const history = run(compound);
console.log(formatTable(history).split("\n").slice(0, 4).join("\n"));
if (Math.abs(history[1]!.stocks.pot! - 123466.0416666) > 0.01) throw new Error("t=1 drift");
```

Growth is `pot × perTick` — the per-tick share of a per-year rate, so the
same model on any grid compounds at the same *annual* rate.

## Reservoirs (hydrology)

Monthly climate rates on daily ticks, proportional evaporation, derived fill
fraction — see `examples/reservoir.ts`: `inflow: rate(180, "month")` and
`evap: pct(2.5, "month")` normalize to the daily tick, and
`fillFraction = storage / capacity` rides every snapshot:

```bash
npx tsx src/cli.ts examples/reservoir.ts
```

The inflow rule reads `c.perTick("inflow")` (a rate constant); evaporation is
proportional: `-c.stocks.storage * c.perTick("evap")`.

## SIR epidemics (transfers + guarded schedules)

`examples/epidemic-sir.ts` is the standard two-transfer SIR on daily
ticks — infection `β·S/N·I`, recovery `γ·I` — plus a campaign pattern:
*weekly vaccination while susceptibles remain*:

```ts
when(
  (c) => c.stocks.susceptible >= c.constants.jabs,   // state guard
  every(7, transfer("susceptible", "recovered", (c) => c.constants.jabs, "weekly vaccination")),
)
```

Guards re-check **every tick**; the schedule only gates *when the inner rule
could* fire. The chain `transfer("susceptible", "infected")` +
`transfer("infected", "recovered")` conserves population exactly — the
derived `curedPlusSickPercent` shows it.

## Dosing schedules

First-order elimination with a recurring dose and a therapy window:

```ts run
import { between, every, flow, model, pct, run } from "kairotron";

const dosing = model({
  horizon: { start: 0, end: 12, unit: "day" },
  constants: { dose: 100, elimination: pct(30, "day") },
  stocks: { drug: 0 },
  rules: [
    every(3, between(1, 10, flow("drug", (c) => c.constants.dose, "dose")), 1),
    flow("drug", (c) => -c.stocks.drug * c.perTick("elimination"), "elimination"),
  ],
});

const drug = run(dosing).map((s) => s.stocks.drug!);
// t=1: dose, then 70% survives; t=2–3: decay only; t=4: dose again
if (Math.abs(drug[1]! - 70) > 1e-9) throw new Error(`t=1: ${drug[1]}`);
if (Math.abs(drug[2]! - 49) > 1e-9) throw new Error(`t=2: ${drug[2]}`);
if (Math.abs(drug[3]! - 34.3) > 1e-9) throw new Error(`t=3: ${drug[3]}`);
if (Math.abs(drug[4]! - 94.01) > 1e-9) throw new Error(`t=4: ${drug[4]}`);
// t=12 is past the between(1,10) window: plain decay, no dose
if (Math.abs(drug[12]! - drug[11]! * 0.7) > 1e-9) throw new Error("no dose after the window");
```

Order matters inside the tick: the dose applies first, so the same tick's
elimination sees the new amount. `every(…, offset 1)` ∘ `between` stacks
prefix-style — doses fall on days 1, 4, 7, 10.

## Delays and the bullwhip (supply chains)

`laggedDelta(stock, n)` bills the amount that moved `n` ticks back — the
supplier ships *last week's sales, as known on two-week-old books*:

```ts run
import { model, run, transfer, laggedDelta } from "kairotron";

const chain = model({
  horizon: { start: 0, end: 24, unit: "week" },
  constants: { demand: 100 },
  stocks: { supplier: 100000, inventory: 150, sold: 0 },
  rules: [
    transfer("inventory", "sold", (c) => Math.min(c.constants.demand, c.stocks.inventory), "demand"),
    transfer("supplier", "inventory", laggedDelta("sold", 2), "shipping 2-week-old books"),
  ],
});

const history = run(chain);
// hand-rolled check: t=1 sells 100 (inv 50); t=2 sells the last 50 — the books
// are still too fresh to ship anything; t=3 ships t=1's sale (+100) but can
// serve no demand that tick. The lag rings inventory on a 3-tick cycle
// (50, 0, 100, 50, 0, 100, …) and half of all demand goes unserved.
const inv = (t: number): number => history[t]!.stocks.inventory!;
if ([50, 0, 100, 50, 0, 100].some((v, i) => inv(i + 1) !== v)) throw new Error("bullwhip ring");
if (history[6]!.stocks.sold !== 300) throw new Error(`300 sold of 600 demanded: ${history[6]!.stocks.sold}`);
```

The lag makes supply ring against demand (watch `inventory` in the chart),
and part of demand ends unserved — full model with derived `fillRatio` in
`examples/supply-chain.ts`.

## Gating windows, one-shots, recurring

```ts run
import { between, flow, model, once, run, unless, every, when } from "kairotron";

const savings = model({
  horizon: { start: 0, end: 24, unit: "month" },
  constants: { save: 500 },
  stocks: { cash: 0, gift: 0 },
  rules: [
    flow("cash", (c) => c.constants.save, "monthly savings"),
    once(12, flow("gift", 1000, "one-shot bonus")),                       // exactly t=12
    between(6, 11, flow("cash", 200, "summer top-up")),                   // 6 ≤ t ≤ 11
    unless((c) => c.t >= 18, every(6, flow("cash", -300, "semiannual fee"))), // while t < 18
    when((c) => c.t >= 20, every(4, flow("cash", 50, "late pension"))),   // from t=20: 20, 24
  ],
});

const history = run(savings);
const cashAt = (t: number): number => history[t]!.stocks.cash!;
if (cashAt(6) - cashAt(5) !== 500 + 200 - 300) throw new Error("t=6: save + top-up + fee");
if (cashAt(13) - cashAt(12) !== 500) throw new Error("t=13: the gift (t=12) and window (t≤11) are done");
if (history[12]!.stocks.gift !== 1000) throw new Error("gift lands at t=12");
if (history[12]!.stocks.cash !== cashAt(11) + 500 + 0 - 300) throw new Error("t=12: save + fee, window closed");
```

Offsets: `every(6, rule, 3)` fires at 3, 9, 15…; rate intervals
(`every(rate(1, "quarter"), …)`) land on whole ticks or the model won't fold.

## Calendar-gated behavior

Rules gate on civil fields when the horizon carries a basis — the plan's
`age >= 73` idiom is ordinary arithmetic on `c.date()`
(`examples/rmd-calendar.ts` derives whole years from birthdate ticks):

```bash
npx tsx src/cli.ts examples/rmd-calendar.ts --end 900   # date column included
```

```text
  t        date            ira       cash   ~age      ~netWorth
---  ----------  -------------  ---------  -----  -------------
877  2048-07-15  11,741,913.27   1,500.00  73.00  11,743,413.27
```

## Derived ratios (acyclic projections)

Derived values form a chain — later lines may read earlier ones, never
themselves or the future:

```ts run
import { derived, flow, model, run } from "kairotron";

const m = model({
  horizon: { start: 0, end: 3, unit: "year" },
  stocks: { good: 60, bad: 40 },
  rules: [flow("good", 10, "grow")],
  derived: [
    derived("total", (c) => c.stocks.good + c.stocks.bad),
    derived("goodShare", (c) => c.stocks.good / c.derived.total), // reads an earlier derived
  ],
});

const d = run(m)[2]!.derived;
if (Math.abs(d.goodShare! - 80 / 120) > 1e-12) throw new Error(`goodShare: ${d.goodShare}`);
```

A forward read (`~a` using `~b` when `~b` is defined later) throws at fold
time naming both — derivations are acyclic by construction, never silently
undefined.

## Stocking all four domains at once

| Exemplar | Exercises | Run |
|---|---|---|
| `examples/retirement.ts` | rates with per-units, derived projections | `npx tsx src/cli.ts examples/retirement.ts --flows` |
| `examples/reservoir.ts` | monthly rates on daily ticks, proportional loss | `npx tsx src/cli.ts examples/reservoir.ts` |
| `examples/epidemic-sir.ts` | transfers, guarded recurring schedules | `npx tsx src/cli.ts examples/epidemic-sir.ts` |
| `examples/supply-chain.ts` | delays, conservation, bullwhip | `npx tsx src/cli.ts examples/supply-chain.ts` |
| `examples/rmd-calendar.ts` | calendar basis, date gating | `npx tsx src/cli.ts examples/rmd-calendar.ts` |
| `examples/retirement-mini.ts` | the same fold in the sugar | `npx tsx src/cli.ts examples/retirement-mini.ts` |
| `examples/retirement-mc.ts` | stochastic rate, seeded paths | `npx tsx src/cli.ts examples/retirement-mc.ts --mc 200` |

## Related

- [DSL reference](/reference/dsl) — semantics behind every construct
- [Mini-notation](/reference/mini-notation) — the same recipes in sugar
