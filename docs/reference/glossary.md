# Glossary

**basis** — The civil moment (epoch-ms, UTC) of tick 0, declared as
`horizon.basis = date("YYYY-MM-DD")`. A display/gating overlay: the fold
stays tick-pure. Anchors tick 0, so it survives re-ticks and is inherited by
forks.

**branch** — A timeline continuing the fold from some committed snapshot with
a different model. Shares the trunk's prefix snapshots by reference.
Produced by `fork()` / `forkMonteCarlo()`.

**constant** — A model value fixed for the run. May *carry* a per-unit rate
(`pct(7, "year")`) — the value is constant; the engine normalizes its
per-tick application. Varying constants between runs is scenario variation,
not mutation.

**convention** (day-count) — How month/quarter/year map onto days for
conversions: `abstract` (364-day year = 52 exact weeks; the default, calendar-
free), `actual/365`, `30/360`. With a `basis`, month/quarter/year ticks step
the civil calendar instead (leap-true; clamped to day 30 under 30/360).

**derived value** — A read-only projection evaluated each tick and attached
to every snapshot (`Sₜ` = stocks + derived). Never feeds the step; acyclic by
construction. Table/CSV column names are prefixed `~`.

**delta** — One rule's contribution to one stock at one tick:
`{ stock, amount, rule, loc? }`. Snapshots carry their tick's deltas — this
is the provenance substrate.

**fold** — The engine's whole execution: `sₜ = step(sₜ₋₁, t, params)` reduced
over the tick range, producing the append-only history.

**fork point** (`forkT`) — The trunk tick at which a branch continues.
`forkTBranch` is the same moment expressed in the branch's own ticks (equal
unless the branch re-ticked).

**gate(d rule)** — A rule wrapped in `when`/`unless`: applies only on ticks
whose guard passes. Re-evaluated every tick (state guards are live).

**hold-last** — Read semantics for sparse or past-the-end lookups: the value
of the most recent snapshot at or before the queried moment (cross-unit fork
prefixes, playhead in a gap, lag across sparse history).

**horizon** — The finite tick range `(start, end, unit)` plus optional
`convention` and `basis`. Runs always terminate at `end`.

**path** — One deterministic Monte Carlo fold: an independent, reproducible
sample of the model's randomness, identified by `(seed, path index)`.

**percentile (output)** — A value level (`pXX`, e.g. p10/p50/p90) of the
across-path distribution at each tick; Monte Carlo's collapse of N paths
(R-7 interpolation).

**provenance** — Every delta carrying the writing rule's label and source
location (`file:line:column`), captured from the stack at construction. What
`--flows` prints and the editor highlight keys off.

**rate** — A constant carrying the unit it accrues per (`value, perUnit`).
Read in rules as `c.perTick(name)` = value normalized to the tick unit via
the day-count table. A flat amount declared per calendar time
(`rate(2750, "month")`) is a rate too.

**re-tick** — Re-expressing a horizon (or fork prefix) on a different tick
unit, duration-preserved; per-tick rate applications re-normalize, so numbers
legitimately change. `retickHorizon`, `--unit`, the REPL unit select.

**rule** — A pure producer of deltas: `flow`, `transfer`, or the same wrapped
in `when`/`unless`/`every`/`once`/`between`.

**scenario (set)** — Saved model code + horizon/MC control values, grouped
into named sets in the browser's `localStorage`. A fresh trunk on load.
Shareable sessions (with playhead + branches) are the separate share-URL
notion.

**share session** — A whole REPL state (trunk code + horizon + MC controls +
playhead + each branch's fork tick & buffer) encoded in a `?m=` URL
parameter; branches replay as forks.

**snapshot** — An immutable per-tick record: `t`, `unit`, `convention?`,
`basis?`, `stocks`, `derived`, `deltas`. Frozen; shared freely.

**stochastic (rate)** — A rate constant marked `stochastic(base, normal(sd))`
or `uniform(low, high)` — a random sequence sampled only under a seeded
Monte Carlo run; read unchanged via `c.perTick`. Noise scales with
`√(tick/perUnit)`, so tick granularity doesn't move the distribution.

**stock** — A named numeric element of the state vector (accounts,
reservoirs, populations, inventory, drug amount). Declared with its tick-0
value.

**tick** — One step of the fold; numbered as a duration from 0 in the horizon
unit. Ticks are plain numbers unless a basis overlays calendar labels.

**tick unit** — `second | minute | hour | day | week | month | quarter |
year`. Semantics, not tempo: it fixes how rates apply, how schedules land,
and (with a basis) how ticks step the calendar.

**whole-tick rule** — Durations crossing unit families must land on whole
ticks under the declared convention, or the engine refuses (horizons,
schedule intervals, cross-unit fork snapshots). Machine-epsilon-scale noise
is tolerated; genuine fractions are not.
