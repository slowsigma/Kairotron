# plan.md — a discrete-time dynamical system REPL

Working title: **Kairotron** (see Naming at the bottom).

Companion to `Concept-Search.md` (discrete-time dynamical systems / stock-and-flow,
via personal finance as the motivating example) and `time-varying-values.md` (no
general-purpose consumer app in this niche exists — the gap this fills).

## One-liner

A text-first playground for discrete-time dynamical systems. You write a model in
code, set a finite time horizon and a tick unit (seconds, minutes, hours, weeks,
months, years), press run, and the engine folds the state vector across the
horizon — producing a timeline you can scrub, inspect, branch, and re-run at a
different tick. Domain-agnostic: finance, hydrology, epidemiology, batteries,
population, dosing schedules, supply chains.

## What to borrow from Strudel / TidalCycles

Both confirm the shape (see strudel technical manual; Tidal "What is a pattern?"):

| Tidal/Strudel concept | This app's analog |
|---|---|
| Pattern = pure function from a timespan (arc) to events | Rule set = pure function from a state to its deltas |
| Scheduler queries `queryArc(t0, t1)` repeatedly | Runner folds `step(s_{t-1})` across the horizon |
| `setcps` / `cpm` — tempo as a number | Tick unit — seconds…years, a first-class part of the model |
| Mini-notation (PEG grammar, syntax sugar transpiled to API calls) | Model DSL with terse sugar for rates/flows/gating |
| Mini-notation `[bd sn]/2`, `<e [g b]>`, `!`, `@` | Terse sugar for schedules: `spend 3k/mo`, `age >= 73 -> rmd`, delays |
| d1/d2 named channels | Named stocks (accounts, reservoirs, populations) |
| Live edit while playing | Re-run / re-fold from any snapshot (immutability makes this native) |
| `xfade` / transitions between patterns | Branching: fork the timeline at tick T into a what-if variant |
| Visual feedback: highlighting the mini-notation elements currently playing (source locations attached to events) | Highlighting the rule/sugar responsible for a stock's change at the current tick |
| Output: audio events | Output: a numeric series (table, chart, CSV) |

## What must differ from Tidal/Strudel

1. **Finite horizon.** Tidal loops until silenced (`seqPLoop`); here every run is
   bounded: `(t0, tN, unit)`. The playhead walks to an end and stops — no infinite
   cycle. (Tidal's `seqP` with start/end times is the closest relative.)
2. **Abstract time by default.** Clock time is just a number of ticks starting at
  zero — Tidal's approach exactly (`type Time = Rational`, no calendar in the
  core); there `day 73` means tick 73, nothing else. Concrete dates are an
  overlay: define a basis constant (`basis = date(1971-03-15)`, i.e. tick 0's
  timestamp) and all time display goes through a built-in like
  `c.when(t)` (or `when(t, tickUnit, basis, convention)` outside a rule) that
  renders the current tick value in calendar terms. Every model works without a basis; models that need dates declare one,
  and only display/validation touches the calendar. Engine semantics stay
  tick-pure regardless.
3. **Clock granularity is semantics, not just tempo.** Changing the tick is not
   only changing speed; it changes what "one step" means. Rates must be
   unit-normalized: `A = P(1 + r/m)^(m*t)` (Concept-Search.md) — a 7%/year rate
   becomes 7/12 per monthly tick, 7/52 per weekly tick, etc. Day-count frictions
   (uneven months, leap years) need an explicit convention, declared in the
   model — irrelevant to abstract-time models, mandatory once a basis exists.
4. **State is quantitative, not qualitative.** Tidal events are discrete hits; here
   each tick produces a full state vector (the "time-traveling ledger" of
   Concept-Search.md). Every snapshot is immutable and retained.
5. **Output is a series, not audio.** Charts, timelines, tables, CSV/JSON exports.
6. **Deterministic by default, stochastic opt-in.** Monte Carlo over random rate
   sequences is a mode (immutability makes it trivially parallel), not the default.

## Core semantics

### Value taxonomy

The system accounts for exactly three kinds of user values, plus built-ins:

- **Constants** — pure fixed values: never time-dependent, never re-assigned.
  Initial balances, thresholds, parameters. A constant may *carry* a per-time
  unit (`growth = 7%/year`); the value stays constant, only the engine's
  normalized application per tick varies. Varying constants between runs is
  scenario variation (the branching mechanism), not mutation within a run.
- **Variables** — the values the system evolves over time: the state vector
  `s` (the "Stocks / state" below). Mutable over time means: each snapshot
  *fixes* the value at tick `t`, computed from `s_{t-1}` by the user-defined
  step function (flows, gating, events). Nothing is rewritten in place —
  per-tick values are immutable snapshots; the sequence of values *is* the
  mutation.
- **Derived values** — pure projections: pure functions of (variables,
  constants, `t`) evaluated each tick and attached to every snapshot. They
  never feed back into the fold — a "derived" value that influenced the step
  would be a rule, not a derivation. Derivations form an acyclic graph
  (a derived value may reference variables, constants, `t`, and other derived
  values, transitively).

- **Built-in readables**: the current tick `t` and the horizon context are
  exposed read-only to rules and derivations. This is how date-based gating
  (`age >= 73`, computed from `t` + basis via `when(...)`) works without any
  special-casing of calendar logic.

This taxonomy carries the Concept-Search.md hybrid: variables hold the numeric
state (the dynamical-system side), while the step function's rules supply the
logic-driven gating; constants and derived values only ever read or bound the
system, never move it.

- **Horizon**: `(start, end, tickUnit)` — e.g. 0–720 ticks in months, or
  weeks 0–780. Abstract time is the default: start and end are tick counts
  (start = 0 conventionally). Adding a basis constant overlay turns tick numbers
  into calendar displays via `c.when(t)` / `when(t, tickUnit, basis, convention)`
  — it never changes engine behavior.
- **Stocks / state (the variables)**: named numeric values; the state vector `[401k: 100000, Roth: 50000, Cash: 20000]` at tick T is the system state.
- **Flows / rules**: pure deltas — `s' = s + inflows(s) - outflows(s)`. Includes state-specific rule classes per stock (the 401k vs Roth vs Cash distinction in Concept-Search.md).
- **Gating**: guarded logic — `if age >= 73 -> rmd(401k -> Cash)`. The pure state-machine side of the hybrid.
- **Events / schedules**: recurring transfers (`+2750/mo`), one-shot events at a tick or condition, delayed effects.
- **Step function**: `s_{t} = step(s_{t-1}, t, params)` — a fold over the tick range. The whole plan is `reduce` over ticks; history is an append-only array of immutable snapshots (`[S0, S1, ... SN]`).
- **Units**: every rate carries a `(value, perUnit)`; the engine normalizes `(r_unit -> r_tick)` at run time. When a basis date exists, a declared unit-convention string (30/360, actual) governs the tick→calendar conversion inside `when(...)`.
- **Branches**: fork from any snapshot, pass the state into a different rule set; Git-like what-if timelines, free because states never mutate.
- **Derived quantities**: the derived values of the taxonomy — named expressions computed from the state at each tick — net worth, portfolio mix, burn rate, survival margin, drawdown — without affecting the fold. Stocks move the system; derivations only read it. They join every snapshot (`S_t` = stocks + derived values) so scrubbing exposes both.
- **Provenance**: every delta written by a rule into a snapshot carries the rule's source location, mirroring Strudel's `withLoc` on mini-notation events. This is what makes playhead-driven code highlighting possible.

## Execution model (REPL flow)

1. Write the model in the DSL (embedded in a host language, Strudel-style).
2. Press Run → parse → validate → normalize rates → fold across the horizon.
3. Inspect: scrub the playhead, hover a tick, see every stock's value; export CSV/JSON.
4. Re-tick: change the tick unit (months → days) and re-run; rates re-normalize.
5. Re-write: edit rules and re-run from tick 0, or fork from the current playhead into a branch.
6. Optional Strudel-style "live" mode: re-evaluate rules mid-run, applied to remaining ticks.

## Visualization

The other reason for the Strudel/Tidal interface: their REPLs don't just run
patterns — they *show* them, syncing the code to the running sound so you can see
which piece of text is producing what you're hearing. The same loop works with
data instead of audio, at every scale from tick to decade:

- **Timeline view (the chart)** — stocks (buckets) as stacked areas or lines
  across the horizon, derived quantities as overlaid curves (net worth = sum of
  buckets, portfolio mix, burn rate, drawdown). Playhead scrubbing is the
  primary interaction — the analog of Strudel's audio playhead, walking a
  finite range instead of an endless cycle.
- **Code highlight view** — at the current tick, the rule/sugar that moved each
  stock highlights in the editor (Strudel's `withLoc` trick: engine tags every
  delta with its source location, the UI lights the locations up). Hovering a
  tick answers "why is this bucket what it is at T?" by pointing at the
  responsible lines.
- **Inspector view** — the state vector at the current tick: stocks, this tick's
  flows, derived values; per-stock sparkline over the horizon.
- **Diagram view (later)** — the classic stock-and-flow boxes/arrows generated
  from the model, arrow thickness pulsing with the current tick's flow
  magnitude.

All views read the same append-only snapshot array; nothing re-runs to look
around — the "time-traveling ledger" of Concept-Search.md is also the
visualization substrate. The chart's x-axis is the normalized horizon, so
switching the tick unit re-scales views without changing the model. Axis labels
depend on the time mode: plain tick numbers by default, calendar labels from
`when(t, tickUnit, basis, convention)` once a basis is declared.

## Architecture sketch

- **core engine** — pure, embeddable library: state types, fold runner, unit conversion, event/gate evaluation. No UI. This is the "Strudel packages" layer.
- **DSL layer** — embedded in the host language plus a small PEG-grammar sugar parser (the mini-notation analog). Host-language call: **TypeScript/JavaScript** — Strudel proves the browser-REPL path end to end (CodeMirror editor, eval/transpile, scheduler; swap the audio scheduler for the fold runner).
- **outputs** — timeline renderer (stacked stock charts + derived curves), table view, CSV/JSON export.
- **UI** — editor pane (with rule highlighting, Strudel-style), horizon + tick-unit controls, playhead scrubber, inspector, branch switcher. "Read, Evaluate, Print, Play" — the R repl tradition, minus the loop.
- **later** — Monte Carlo workers (immutable timelines = zero-race parallelism), shareable model URLs, saved scenario sets.

## Milestones

1. **Engine prototype (CLI)**: fold runner + tick units + stock/flow DSL; prints a table per tick. Finance pot not hardcoded — hydrology/population-friendly.
2. **Gating & events**: guarded rules, one-shot and recurring schedules, delays.
3. **Derived quantities**: read-only expressions over the state, attached to snapshots.
4. **Browser REPL with visualization**: editor + run + stacked timeline chart + scrubber + playhead-linked code highlighting (provenance tags land in milestone 1's snapshot format from the start so this drops in).
5. **Branches & what-if**: fork from snapshot, side-by-side comparison.
6. **Tick re-normalization**: change tick unit on the same model; day-count conventions.
7. **Calendar overlay**: basis constant + `c.when(t)` / `when(t, tickUnit, basis, convention)` for display, gating on dates, and validated tick↔calendar conversion (leap years, 30/360 vs actual).
8. **Monte Carlo mode**: random rate sequences, worker pool, percentile output (visualization gains percentile bands over the timeline).

## Naming

Requirement: evokes discrete steps over bounded time, not finance, not music, in the
 tradition of a single evocative word ("Tidal", "Strudel").

- **Kairotron** (recommended) — from kairos (opportunity-time / the right moment) + the -tron instrument suffix, as in cyclotron and — in live-coding lineage — machines that turn language into something running. Evokes discrete steps over chosen time without pointing at any domain.
- **Tickflow** — the most literal: tick + stock-and-flow. Plain but unambiguous.
- **Chronofold** — time + fold; names the engine exactly. Collision note: a small Rust crate (CRDT log) shares the name.
- **Weir** — a dam you set the flow over; leans into the reservoir metaphor from Concept-Search.md. Short, water/flow lineage matching Tidal.
- **Stepwell** — an Indian stepwell: a stock you descend discrete steps to reach. Stocks + steps in one image; friendlier/cozier tone.

## References

- Strudel technical manual (REPL: transpile → eval → Pattern → scheduler):
  <https://github.com/tidalcycles/strudel/wiki/Technical-Manual>
- Strudel patterns (Pattern = function from timespan to events; queryArc):
  <https://strudel.cc/technical-manual/patterns>
- Strudel REPL doc (playhead sync: highlighting mini-notation elements currently playing):
  <https://strudel.cc/technical-manual/repl>
- Strudel visual feedback (learning + live use through synchronized display):
  <https://strudel.cc/learn/visual-feedback/>
- TidalCycles, "What is a pattern?" (arc/query model, rational time):
  <https://tidalcycles.org/docs/innards/what_is_a_pattern>
- TidalCycles, Composition reference (`seqP`, `seqPLoop` — bounded loops; closest relative to a finite horizon):
  <https://tidalcycles.org/docs/reference/composition/>
- TidalCycles, Performance reference (`resetCycles`, `setCycle`, `setcps`, triggers):
  <https://tidalcycles.org/docs/reference/performance/>
- Local: `Concept-Search.md` (domain math), `time-varying-values.md` (landscape / prior art).
