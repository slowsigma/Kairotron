# Current issues — code review findings

Review of Kairotron against `docs/plan.md`. No code has been changed yet.

Baseline at time of review:
- `npm test` — 16 files / 211 tests passing
- `npm run typecheck` — clean
- `npm run build` — clean
- Working tree contains milestone 8 (Monte Carlo) changes that are not yet committed.

These are semantic and edge-case issues not covered by the existing suite.

---

## 1. HIGH — Horizon context is mutable, corrupting the run and the model

**Plan ref:** `docs/plan.md:86-89` — built-in readables (`t`, horizon context) are read-only.

**Locations:**
- `src/core/fold.ts:385-394` — `DerivedContext` exposes `horizon`
- `src/core/fold.ts:473-499` — `TickContext` exposes `horizon`
- `src/core/types.ts:101`, `src/core/types.ts:115` — only TypeScript `readonly`, no runtime freeze
- `src/dsl/model.ts:99-105` — `model()` returns the horizon object unfrozen

**Observed:** A rule can do `(c.horizon as any).unit = "year"`. The engine immediately uses the new unit for `perTick`, schedules, and snapshot metadata. Reproduced with a monthly model: at tick 1 the growth rate switched from 7/12 to 7% and subsequent snapshots were tagged `unit: "year"`. Mutating `basis` also permanently mutates `model.horizon`, so a second `run()` on the same model differs. This violates immutable snapshots, read-only built-ins, and fork/branch determinism.

**Suggested fix:** Freeze a horizon snapshot once at fold entry and pass that frozen object into both contexts. Also freeze the horizon in `model()` (or deep-freeze). Add a test that a rule attempting to mutate `c.horizon` throws (or is otherwise ineffective) and that reruns are identical.

---

## 2. HIGH — Under `30/360`, the basis does not anchor tick 0

**Plan ref:** `docs/plan.md:21-30`, `docs/plan.md:40-48` — `horizon.basis` anchors tick 0's civil moment.

**Location:** `src/core/calendar.ts:68-84` (`civilStep`). The 30/360 day clamp (`Math.min(base.getUTCDate(), 30)`) is applied unconditionally, including when `nMonths === 0`.

**Observed:**
```ts
tickToMs(0, "month", date("2000-01-31"), "30/360")
// => 2000-01-30, not the declared basis 2000-01-31
```
Consequences:
- table/CSV/inspector show `2000-01-30` at `t=0`;
- `msToTick(basis, ...)` returns `undefined`, i.e. the declared basis is not on its own grid;
- `retickHorizon`, `formatDiff`, and `tickAtOrBefore` inherit the one-day shift.

**Suggested fix:** Return `basis` unchanged when `nMonths === 0`; only clamp when actually stepping. Add a test asserting `whenDate(0, ...) === basis` and `msToTick(basis, ...) === 0`, including a 30/360 basis on the 31st.

---

## 3. HIGH — `when(t, unit, basis)` ignores the model's declared convention

**Plan ref:** `docs/plan.md:106` — "a declared unit-convention string (30/360, actual) governs the tick→calendar conversion inside `when(...)`".

**Locations:**
- `src/dsl/model.ts:218-241` — free-function `when(t, unit, basis, convention?)`
- `src/core/calendar.ts:223-230` — `whenDate` defaults to `actual/365`

**Observed:** With a `30/360` horizon and basis `2000-01-31`:
```ts
c.date().day                    // 30 at t=2
when(c.t, "month", basis).day   // 31
```
`c.date()` and snapshots use the horizon convention; the plan-shaped `when(...)` call used in the README does not. Date gating through `when(...)` can disagree with gating through `c.date()`.

**Suggested fix:** Add a horizon-bound form (e.g. `c.when(t)` / make `c.date(t)` the primary documented API), make the convention argument mandatory and update the README/plan example, or thread the model convention into the DSL call. Add a test comparing `c.date()` with the `when(...)` form under `30/360`.

---

## 4. MEDIUM — Cross-unit Monte Carlo forks are silently not same-world

**Plan ref:** milestone 8 / README — "each branch path continues its trunk path's own shock sequence".

**Locations:**
- `src/core/mc.ts:61-67` — `forkMonteCarlo` forwards any branch horizon to `fork`
- `src/core/fold.ts:200-251` — `remapPrefix` produces a sparse prefix for reticked branches
- `src/core/fold.ts:435-439` — replay consumes `seed.prefix.length` draws

**Observed:** For a reticked branch, the remapped prefix is sparse and the branch grid has different tick durations, so one i.i.d. draw per branch tick cannot correspond to the trunk's per-tick draws. Reproduced with a 20-year trunk reticked to months: an unchanged branch diverged from the trunk (path 0 end: trunk ≈ 534, branch ≈ 1235). The CLI/web messages and README still claim the same world.

**Suggested fix:** Reject `forkMonteCarlo` when unit/convention/basis differ, or clearly document that reticked MC branches are new worlds. Add a regression test covering a reticked MC fork.

---

## 5. MEDIUM — MC branch/refork can mix seeds

**Locations:**
- `web/src/main.ts:432` — branch run uses `mcSeed` from the form, not the trunk's seed
- `web/src/main.ts:399` — trunk refork uses `b.mc.seed`, not the new trunk seed

**Observed:**
- Branch: `forkMonteCarlo(th.mc, ..., { seed: mcSeed, horizon })` pairs trunk-prefix states (from the trunk seed) with a continuation stream from a possibly different form seed.
- Refork: after re-running the trunk with a new seed, `forkMonteCarlo(mc, ..., { seed: b.mc.seed, ... })` pairs new-trunk-prefix states with the old branch seed. The result is a chimera, not same-world.

**Suggested fix:** Always use `trunk.mc.seed` for same-world continuation, or reject when the requested seed differs. Add a test that a branch with a different UI seed either replays the trunk world or errors clearly.

---

## 6. MEDIUM — Uniform stochastic bands are not tick-invariant

**Plan/README ref:** milestone 8 — "sqrt-time volatility scaling (tick granularity doesn't change the spread)"; README says the same in the general MC section.

**Locations:**
- `src/core/units.ts:100-107` — `normalizeVolatility` sqrt-scales normal volatility
- `src/core/fold.ts:316-320` — uniform bounds use `normalizeRate` (linear scaling)

**Observed:** For `uniform(pct(-10,"year"), pct(10,"year"))` over 10 years with 20k paths:
```
yearly  E[X^2]/E[X]^2 ≈ 1.033
monthly E[X^2]/E[X]^2 ≈ 1.003
```
Reticking a uniform model changes its outcome spread, contradicting the claim.

**Suggested fix:** Decide the intended semantics. If invariant spread is intended, scale the uniform *width* by sqrt-time as well. Otherwise document that uniform bounds are per-tick rates and reticking changes the model, and adjust the README/milestone text. Add a tick-invariance test for uniform alongside the existing normal one.

---

## Minor / hardening

### A. `nearestWholeTick` relative epsilon is too loose at large tick counts
`src/core/units.ts:127-131`.
```ts
nearestWholeTick(1e9 + 0.5) // accepted as 1e9 + 1
```
The tolerance is `1e-9 * max(1, |ticks|)`, so for second ticks over decades it can silently accept a fraction of thousands of seconds instead of refusing. Use an absolute or much tighter epsilon, or scale by machine epsilon rather than `1e-9`.

### B. User-named keys in plain objects
`src/core/fold.ts:279-286` (constants maps) and `src/core/fold.ts:355-401` (derived `out` object).
A derived value named `__proto__` is silently swallowed (`out["__proto__"] = value` sets the prototype), while `c.derived` then throws as unknown. Consider rejecting `__proto__` / `constructor` / `prototype` as names, or using `Object.create(null)` for these records.

### C. Test gaps that let the above through
- 30/360 basis at `t=0` (`whenDate(0)`, `msToTick(basis)`).
- `when(...)` vs `c.date()` under `30/360`.
- Cross-unit `forkMonteCarlo`.
- MC branch seed mismatch and trunk-refork after a seed change.
- Reticked uniform spread.
- Mutation attempts on `c.horizon` / `c.horizon.basis`.

---

## Suggested order of work

1. Freeze the horizon (#1) — smallest change, prevents permanent model corruption.
2. Fix 30/360 tick 0 (#2) and add calendar regression tests.
3. Resolve `when(...)` convention (#3) — decide API shape (likely a ctx-bound helper).
4. Make `forkMonteCarlo` reject incompatible grids (#4) and fix seed handling (#5).
5. Decide uniform semantics and update code/docs/tests (#6).
6. Treat Minor A/B as hardening if time permits.
