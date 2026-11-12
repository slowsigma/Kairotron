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
  a display/gating overlay (`c.when(t)` / `when(t, tickUnit, basis, convention)`),
  never engine semantics.
  The basis is `horizon.basis = date("YYYY-MM-DD")` (epoch-ms UTC), requires a
  calendar convention (`actual/365`/`30/360`, never `abstract`), anchors tick 0,
  and survives re-ticks and forks (a branch inherits the trunk's). Month/quarter/
  year ticks step the civil calendar with day-of-month clamping (leap-true;
  30/360 anchors at day 30); other units convert through the ratio table. Rules
  gate via `c.date()` / `c.when(t)` or the `when(t, unit, basis, convention)`
  overload; snapshots carry
  `basis` so tables/CSV gain a `date` column and chart axes get calendar labels.
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
3. **Derived quantities** — read-only projections on every snapshot ✓ done
4. **Browser REPL + visualization** — editor + run + stacked timeline chart +
   scrubber + playhead-linked code highlighting ✓ done
5. Branches & what-if — fork from snapshot, Δ-vs-trunk overlay ✓ done
6. Tick re-normalization + day-count conventions (`DayCount` on the horizon,
   duration-preserving `retickHorizon`, cross-unit forks with a duration-mapped
   sparse prefix and hold-last lag) ✓ done
7. Calendar overlay (`horizon.basis` + `date()`, `c.when(t)` / `c.date()` and the
   free `when(t, unit, basis, convention)`
   gating, civil tick↔date conversion with leap-true clamping, date column &
   calendar axes; basis survives re-ticks and forks) ✓ done
8. Monte Carlo mode — stochastic rate sequences (`stochastic(pct(7,"year"),
   normal(pct(15,"year")))` / `uniform(low,high)`), seeded reproducible paths
   (`runPaths`, same seed = same paths), sqrt-time volatility scaling (tick
   granularity doesn't change the spread, normal or uniform), same-world forks
   (`forkMonteCarlo`: each branch path replays its trunk path's draws; the
   branch must keep the trunk's tick grid), percentile output
   (`summarizeMonteCarlo`, `·pXX` tables/CSV), worker pool + percentile bands
   in the browser REPL, `--mc/--seed/--percentiles` in the CLI ✓ done
9. Polished documentation — VitePress docs set in `docs/` (concepts,
   getting-started, browser-REPL/units-calendar/branches/Monte Carlo guides,
   DSL + mini-notation + CLI + outputs references, cookbook, embedding,
   troubleshooting, glossary, contributor guide; local search + light/dark).
   Fenced blocks tagged ` ```ts run ` are self-checking programs extracted by
   `scripts/check-doc-examples.ts`, imported/executed under tsx (the
   `kairotron` tsconfig path maps to `src/index.ts`) and then typechecked with
   the project's strict settings; the same script also validates internal
   links and heading anchors (VitePress only checks pages). `npm run docs:dev`
   serves it, `npm run docs:check` (examples + site build incl. dead-page
   check) runs in CI alongside typecheck and vitest. ✓ done

## Conventions

- Host language: TypeScript (per plan.md's architecture sketch; Strudel proves
  the path). Confirm against plan.md before deviating.
- Engine code must stay pure and domain-agnostic: no finance vocabulary in the
  core; stocks/rules are user-named.
- Test with realistic exemplar models (e.g. a retirement cashflow, a reservoir)
  rather than toy one-liners; numerical checks belong next to the fold tests.
- Browser REPL lives in `web/` (Vite + vanilla TS, zero runtime deps; the engine
  is imported unchanged and stays UI-free). Model code runs via `new Function`
  with the DSL in scope; provenance line-mapping is calibrated at compile time.
  Monte Carlo path folds run on a Vite module-worker pool (`mc-pool.ts` +
  `mc-worker.ts`) with a sequential fallback where `Worker` is unavailable.
  `npm run dev` serves it, `npm run build` bundles it, UI wiring is smoke-tested
  under jsdom (`test/ui-smoke.test.ts`, Monte Carlo in `test/ui-mc.test.ts`;
  the pool protocol is covered by `test/mc-pool.test.ts` with a stubbed Worker).
- Docs site (milestone 9) lives in `docs/` as VitePress (devDependency; the
  design notes `plan.md`/`Concept-Search.md`/`time-varying-values.md` are
  `srcExclude`d from the build). ` ```ts run ` blocks are executable tests —
  self-contained programs importing `"kairotron"` (a tsconfig path), asserting
  their own numbers with fixed seeds; keep them passing via
  `npm run docs:check` (also validates internal links and anchors).
  Shareable model URLs (plan.md's "later") live in `web/src/share.ts`: the
  session (trunk code + horizon/MC control values + playhead + each branch's
  fork tick and buffer) JSON-encodes to one `?m=` query parameter,
  deflate-raw + base64url with an uncompressed (`j`-prefixed) fallback where
  `CompressionStream` is absent; branches ride as forks and replay on load.
  `runNow()` resolves a success boolean so the replay can count failures.
  Codec tested in `test/share.test.ts`, end-to-end in `test/ui-share.test.ts`.
  Saved scenario sets (also plan.md's "later") live in `web/src/scenarios.ts`:
  scenarios (model code + horizon/MC control values — the session minus
  playhead/branches, validated through the share codec) grouped into named
  sets in `localStorage` (`kairotron.scenarios.v1`, injected as a `StorageLike`
  so the module tests need no DOM); the toolbar dropdown loads a scenario via
  apply + re-run. Pure store in `test/scenarios.test.ts`, UI flow in
  `test/ui-scenarios.test.ts`.
