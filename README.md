<p align="center">
  <img src="docs/banner.svg" alt="Kairotron — fold your system across time" width="960">
</p>

# Kairotron

A text-first playground for **discrete-time dynamical systems** — the stock-and-flow
tradition of TidalCycles and Strudel, applied to numbers instead of sound.

You write a model in a small DSL, set a finite horizon `(start, end, tickUnit)`, press
**Run**, and the engine *folds the state vector across the ticks* — producing an
append-only timeline of immutable snapshots you can scrub, inspect, export, and
re-run at a different tick. Domain-agnostic by design: finance, hydrology,
epidemiology, batteries, population, dosing schedules, supply chains. Nothing
domain-specific is hardcoded in the engine.

> Tidal turns patterns into sound. Kairotron turns rules into a series — and
> shows you *which line of code* moved each stock at each tick.

## Quick start

```bash
npm install

# Text-first: run an example model in the CLI
npx tsx src/cli.ts examples/retirement.ts --flows

# What-if: fork a branch at tick 6 where a raise lifts the contribution
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-boost.ts --diff

# Browser REPL: live editor + timeline chart + scrubber + code highlighting
npm run dev        # serves web/ with Vite

# Tests (87, incl. numeric verification against hand-rolled loops)
npm test
```

## One model, end to end

Monthly retirement cashflow — a growing pre-tax pot, cash on a lower yield
([full source](examples/retirement.ts)):

```ts
import { derived, flow, model, pct } from "./src/dsl/model.js";

export default model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: {
    contribution: 2750,
    growth: pct(7, "year"),      // rate carries its unit; the engine
    cashYield:  pct(1.5, "year") // normalizes it to the tick at run time
  },
  stocks: {
    preTax: 120000,
    cash: 25000
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth @ 7%/year"),
    flow("cash",   (c) => c.stocks.cash * c.perTick("cashYield"), "interest @ 1.5%/year")
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash)
  ]
});
```

Run it and you get a table — a snapshot per tick, derived values marked `~`:

```
  t      preTax       cash   ~netWorth
 --  ----------  ---------  ---------
  0  120,000.00  25,000.00  145,000.00
  1  123,466.04  25,031.25  148,497.29
  2  126,952.30  25,062.54  152,014.84
```

Add `--flows` and every delta comes with **provenance**: which rule wrote it, from
which source line. This is what powers playhead-linked code highlighting in the REPL.

```
t=1
      +2,750.00  preTax  monthly contribution  @examples/retirement.ts:17:5
        +716.04  preTax  growth @ 7%/year      @examples/retirement.ts:18:5
         +31.25  cash    interest @ 1.5%/year  @examples/retirement.ts:19:5
```

Because the tick unit is **semantics**, not just tempo, re-ticking changes the model
rather than re-scoring it — `--unit year` re-expresses the same *duration* on a
yearly grid (0..12 monthly ticks become 0..1 yearly tick), re-normalizing the
7%/year rate so the contribution means something different per tick:

| | monthly tick | yearly tick |
|---|---|---|
| growth per tick | 7%/12 | 7% |
| contribution per tick | 2750 | 2750 (applied once) |
| result after tick 1 | `162,953` after 12 ticks | `131,342` after 1 tick |

Conversions that assume a calendar need a declared **day-count convention**
(`--convention abstract | actual/365 | 30/360`): the abstract year is exactly
52 weeks (364 days), so quarterly schedules land on whole daily ticks there and
on 30/360 (90 days) but not under actual/365 (91.25) — where the engine refuses
rather than fudging. A duration that doesn't divide into whole ticks is rejected
the same way; `--end` always takes raw ticks in the target unit if you want it.

Forks re-tick too: `--fork-at 6` onto a daily variant re-expresses the trunk's
first six monthly ticks at their exact daily moments (months 1, 2, 4, 5 land
between days and drop out of the shared prefix; months 0, 3, 6 land on days 0,
91, 182), `lagged` reads that sparse prefix hold-last, and `--diff` aligns the
trunk by duration:

```
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-daily.ts --diff
```

## How it works

The whole engine is `reduce` over ticks: `s_t = step(s_{t-1}, t, params)`.

- **Three kinds of values.** *Constants* (fixed, may carry a per-unit rate),
  *variables* (the state vector of named numeric stocks, evolved by the fold,
  never mutated in place), and *derived values* (read-only projections attached
  to every snapshot — acyclic by construction, they can never feed back into
  the step).
- **Immutable snapshots.** History is an append-only array of frozen state
  vectors, each tagged with the deltas and the source locations that produced
  them. Nothing is rewritten — the sequence of fixed values *is* the mutation.
- **Abstract time by default.** Ticks are plain numbers. A calendar is a
  display overlay you add later (`date(1971-03-15)` basis renders ticks as
  dates), never engine semantics — exactly Tidal's `Time = Rational` position.
- **Rates carry units.** `pct(7, "year")` becomes 7/12 per monthly tick,
  7/52 per weekly tick. Change the tick unit, change the meaning. Cross-unit
  conversion is duration-preserving and governed by a declared **day-count
  convention** (`abstract`, `actual/365`, `30/360`) — everything must land on
  whole ticks or the engine says so.
- **Gating, schedules, delays.** Rules compose: `when(guard, rule)`,
  `unless(...)`, `every(7, ...)`, `once(t, ...)`, `between(a, b, ...)`, and
  `lagged(stock, n)` for dependencies on earlier snapshots.
- **Branches are free.** `fork(history, t, variantModel)` continues the fold from
  any snapshot with a different rule set — the shared prefix is the *same* frozen
  snapshots, `lagged` reads across the fork point into the trunk, and a variant
  can even run past the trunk's horizon. Retire at 60 vs 65 costs no copies. A
  branch may even continue on a **different tick unit**: the trunk prefix is
  re-expressed at the moments where both grids agree, and `lagged` reads it
  hold-last.
- **Deterministic by default.** Monte Carlo is an opt-in mode on the roadmap,
  not the default execution model.

## Examples

Realistic exemplars, each verified tick-by-tick against a hand-rolled loop in
[`test/examples.test.ts`](test/examples.test.ts):

| Model | Domain | What it exercises |
|---|---|---|
| [`retirement.ts`](examples/retirement.ts) | personal finance | rates with per-units, derived projections |
| [`retirement-boost.ts`](examples/retirement-boost.ts) | personal finance | what-if fork of the model above (raise at tick 6) |
| [`retirement-daily.ts`](examples/retirement-daily.ts) | personal finance | re-ticked fork: the same year on a daily grid |
| [`reservoir.ts`](examples/reservoir.ts) | hydrology | monthly rates on daily ticks, proportional evaporation |
| [`epidemic-sir.ts`](examples/epidemic-sir.ts) | epidemiology | stock↔stock transfers, guarded recurring schedules |
| [`supply-chain.ts`](examples/supply-chain.ts) | operations | delays, conservation of units, bullwhip oscillation |

## Browser REPL

`npm run dev` starts a REPL with a model editor and a stacked timeline of the
stocks. Scrub the playhead (or use the arrow keys) and the editor highlights
*the rule that moved each stock at that tick* — Strudel's
[`withLoc` trick](https://strudel.cc/learn/visual-feedback/), aimed at data.
Tab through the inspector for the full state vector at any tick, and export
the history as CSV or JSON. The toolbar re-ticks without touching the model:
changing **unit** with start/end on auto re-expresses the horizon at the same
duration (rates re-normalize), and **convention** switches the day-count basis.

**⑂ Fork** branches the timeline at the playhead: the branch gets its own editor
buffer, the trunk's continuation ghosts behind it as dashed lines, and a Δ-pane
plots branch-minus-trunk — the what-if answer, per stock, per tick. Branch chips
switch timelines; re-running the trunk re-forks them automatically.

Zero runtime dependencies: the engine imports unchanged from `src/`, the UI is
vanilla TypeScript over SVG.

## Project layout

```
src/
  core/     fold runner, units, immutable snapshot types (pure, no UI)
  dsl/      model({...}) builder + rule constructors + provenance capture
  outputs/  table / CSV / flows renderers
web/        browser REPL (Vite, vanilla TS — editor, chart, scrubber, inspector)
examples/   exemplar models across four domains
test/       units, fold, gating, derived, exemplars, REPL, UI smoke tests
docs/       plan.md (the plan), Concept-Search.md, time-varying-values.md
```

## Roadmap

Milestones from [`docs/plan.md`](docs/plan.md):

- [x] Engine prototype — fold runner, tick units, stock/flow DSL, CLI table
- [x] Gating & events — guards, one-shot / recurring schedules, delays
- [x] Derived quantities — read-only projections on every snapshot
- [x] Browser REPL — editor, stacked timeline, scrubber, code highlighting
- [x] Branches & what-if — fork from any snapshot (free, because states never mutate)
- [x] Tick re-normalization — same model, new tick unit; day-count conventions
- [ ] Calendar overlay — basis constant + calendar display and gating
- [ ] Monte Carlo mode — random rate sequences, worker pool, percentile bands

## Design docs

- [`docs/plan.md`](docs/plan.md) — semantics, execution model, naming, milestones
- [`docs/Concept-Search.md`](docs/Concept-Search.md) — the domain math
- [`docs/time-varying-values.md`](docs/time-varying-values.md) — the prior-art landscape

## License

MIT — see [`LICENSE`](LICENSE).
