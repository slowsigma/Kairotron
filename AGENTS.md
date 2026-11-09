# Kairotron

Text-first, domain-agnostic discrete-time dynamical-systems REPL (stock-and-flow).
Modeled after TidalCycles/Strudel: you write a model in a small DSL, set a finite
horizon `(t0, tN, tickUnit)`, and the engine folds a pure step function over the
ticks, producing an append-only array of immutable snapshots you can scrub,
inspect, branch, and re-run. Output is a numeric series (table, chart, CSV/JSON),
not audio. Domains: finance, hydrology, epidemiology, batteries, population,
dosing, supply chains — nothing finance-specific is hardcoded in the engine.

**The working plan is `docs/plan.md` — read it fully before any work.**
Companion research: `docs/Concept-Search.md` (domain math),
`docs/time-varying-values.md` (prior art / landscape).

## Core semantics (digest — plan.md is authoritative)

- **Value taxonomy**: *constants* (fixed, may carry a per-unit rate like `7%/year`),
  *variables* = the state vector of named numeric stocks (evolve via the fold;
  never mutated in place), *derived values* (read-only projections attached to
  every snapshot; acyclic; must never feed back into the step function).
  Built-ins `t` and horizon context are read-only everywhere.
- **Fold**: `s_t = step(s_{t-1}, t, params)`; history is `[S0, S1, ... SN]`,
  finite horizon only — no infinite looping.
- **Abstract time is the default**: ticks are plain numbers; a calendar basis is
  a display/gating overlay (`when(t, tickUnit, basis)`), never engine semantics.
- **Units are semantics**: every rate carries `(value, perUnit)`; the engine
  normalizes rates to the tick unit at run time. Changing the tick unit can
  change model semantics, not just tempo.
- **Deterministic by default**, stochastic (Monte Carlo) is an opt-in mode.
- **Provenance**: every delta a rule writes carries its source location
  (Strudel's `withLoc` analog), so a UI can highlight the rule responsible for
  a change at the current tick. Snapshot format must carry provenance from the
  start, even in the CLI prototype.
- **Branches**: forking from any snapshot is free because states are immutable.

## Architecture layers

- `core engine` — pure, embeddable: state types, fold runner, unit conversion,
  event/gate evaluation. No UI.
- `DSL layer` — embedded in the host language + small PEG-grammar sugar parser
  (the mini-notation analog).
- `outputs` — table/chart/CSV/JSON.
- UI (later): editor with playhead-linked rule highlighting, scrubber, inspector.

## Milestones (from plan.md)

1. **Engine prototype (CLI)** — fold runner + tick units + stock/flow DSL,
   prints a table per tick. ✓ done
2. **Gating & events** (guarded rules, one-shot/recurring schedules, delays) ✓ done
3. Derived quantities ← current
4. Browser REPL + timeline chart + scrubber + code highlighting
5. Branches & what-if
6. Tick re-normalization + day-count conventions
7. Calendar overlay (basis + `when(...)`)
8. Monte Carlo mode

## Conventions

- Host language: TypeScript (per plan.md's architecture sketch; Strudel proves
  the path). Confirm against plan.md before deviating.
- Engine code must stay pure and domain-agnostic: no finance vocabulary in the
  core; stocks/rules are user-named.
- Test with realistic exemplar models (e.g. a retirement cashflow, a reservoir)
  rather than toy one-liners; numerical checks belong next to the fold tests.
