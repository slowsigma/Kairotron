# Monte Carlo

**Deterministic by default.** A plain run folds the expected value even when
the model declares randomness. Monte Carlo is the opt-in mode that samples
the declared noise: N independent seeded folds of one model, collapsed into a
percentile timeline.

## Declaring randomness

A rate constant becomes a random sequence via `stochastic(base, dist)` —
rules keep reading it through `c.perTick(name)`:

```ts
constants: {
  contribution: 2750,
  growth: stochastic(pct(7, "year"), normal(pct(15, "year"))), // 7%/yr mean, 15%/yr vol
  cashYield: pct(1.5, "year"),                                  // stays deterministic
}
```

- `normal(sd)` — additive noise around the base rate: each tick's rate is
  `mean + σ_tick × z`, `z ~ N(0,1)`.
- `uniform(low, high)` — a per-unit band; the midpoint is the expected rate
  and each tick draws uniformly inside the (tick-scaled) band. Bounds must
  share one `perUnit`.

**Volatility is scaled by `√(tick/perUnit)`, not linearly.** A 15%/year σ is
15/√12 % per monthly tick — independent per-tick shocks then produce the same
*outcome* spread at any tick granularity. Re-ticking a stochastic model from
monthly to daily moves the noise, not the answer's distribution: tick
granularity stays semantics for the mean and *irrelevant* for the spread.

## Sampling paths

CLI — fold N paths sequentially, print the percentile timeline instead of one
history:

```bash
npx tsx src/cli.ts examples/retirement-mc.ts --mc 2000 --seed 3 --percentiles 5,50,95
```

```text
monte carlo — 2000 paths × 240 ticks · seed 3
  t   preTax·p5    preTax·p50    preTax·p95    cash·p5   cash·p50   cash·p95  ~netWorth·p5  ~netWorth·p50  ~netWorth·p95
---  ----------  ------------  ------------  ---------  ---------  ---------  ------------  -------------  -------------
  0  120,000.00    120,000.00    120,000.00  25,000.00  25,000.00  25,000.00    145,000.00     145,000.00     145,000.00
240  770,714.15  1,685,034.99  3,878,220.04  33,740.15  33,740.15  33,740.15    804,454.30   1,718,775.14   3,911,960.19
```

The `cash` columns collapse everywhere — nothing random touches them — and
the path mean converges to the deterministic fold: the noise is
mean-preserving, it redistributes.

Browser — set **mc paths** in the toolbar. The deterministic fold still runs
(it is the scrub/fork baseline), paths fold on a **worker pool** (the engine
is pure, so ranges of paths split trivially; sequential fallback where
`Worker` is unavailable), and charts swap to p10–p90 / p25–p75 bands with the
median line. The inspector and CSV/JSON export report the tick's
distribution.

Embedding — `runPaths(model, { paths, seed?, horizon? })` returns a
`MonteCarloResult` of raw immutable timelines; `summarizeMonteCarlo(mc,
percentiles?)` collapses them (default p10/p50/p90; R-7/NumPy-style linear
interpolation between ranks):

```ts run
import { flow, model, percentile, pct, run, runPaths, stochastic, normal, summarizeMonteCarlo } from "kairotron";
import type { Snapshot } from "kairotron";

const m = model({
  horizon: { start: 0, end: 240, unit: "month" },
  constants: {
    contribution: 2750,
    growth: stochastic(pct(7, "year"), normal(pct(15, "year"))),
  },
  stocks: { pot: 120000 },
  rules: [
    flow("pot", (c) => c.constants.contribution, "contribution"),
    flow("pot", (c) => c.stocks.pot * c.perTick("growth"), "growth (stochastic)"),
  ],
});

const finalPot = (h: readonly Snapshot[]): number => h[h.length - 1]!.stocks.pot!;

const mc = runPaths(m, { paths: 200, seed: 1 });
const again = runPaths(m, { paths: 200, seed: 1 });

// same seed ⇒ bit-for-bit identical paths, in any order, any number of times
if (finalPot(mc.timelines[7]!) !== finalPot(again.timelines[7]!)) throw new Error("paths must replay exactly");
// changing the seed changes the world
if (finalPot(runPaths(m, { paths: 200, seed: 2 }).timelines[7]!) === finalPot(mc.timelines[7]!)) {
  throw new Error("seed 2 should differ from seed 1");
}
// a path's stream is (seed, path index) alone: adding paths never shifts existing ones
if (finalPot(runPaths(m, { paths: 8, seed: 1 }).timelines[0]!) !== finalPot(mc.timelines[0]!)) {
  throw new Error("path 0 of seed 1 must be reproducible standalone");
}

// the percentile table collapses the paths
const summary = summarizeMonteCarlo(mc);
const lastRow = summary.rows[summary.rows.length - 1]!;
console.log(summary.labels, lastRow.stocks.pot); // { p10: …, p50: …, p90: … }

// the plain run is the expected value, and the noise is mean-preserving:
// the path mean converges to it (per-tick shocks are additive on the rate)
const expected = finalPot(run(m));
const mean = mc.timelines.map(finalPot).reduce((a, b) => a + b, 0) / mc.timelines.length;
console.log("expected t=240:", expected.toFixed(2), "· path mean:", mean.toFixed(2));
if (Math.abs(mean / expected - 1) > 0.08) throw new Error("path mean should converge to the expected fold");
if (!Number.isFinite(percentile(mc.timelines.map(finalPot).sort((a, b) => a - b), 50))) {
  throw new Error("percentile should be finite");
}
```

## Reproducibility guarantees

- Path *p* of master seed *s* gets its own well-mixed stream — so adding,
  removing, or reordering paths never shifts another path's draws, and a
  worker pool splitting the path range produces identical results to a
  sequential fold.
- Draws depend only on the tick grid, **not** on guard outcomes: one draw per
  stochastic constant per tick in declaration order happens whether or not
  any rule reads it. That's what lets a fork replay the prefix and continue
  the same world.
- The stream is splitmix32 + Box-Muller with the spare cached inside the
  generator — no wall-clock, no scheduling races.

## Same-world what-ifs

`forkMonteCarlo(trunk, atT, variant)` forks every path: path *i* continues
path *i*'s shocks. The percentile gap branch-vs-trunk is then the decision
alone. Constraint: the branch keeps the trunk's tick grid — unit, convention,
and basis must match, because a different grid means one draw per branch tick
is a different world. The CLI applies this automatically for
`--mc --fork-at/--variant` (the branch inherits the trunk's seed); in the
REPL a branch with paths on always rides the trunk's world.

The trade-off, concretely, with `retirement-mc-cautious.ts` — a 10%/month
de-risking sweep from tick 120 — raises the bad tail while lowering the good
one.

## Cost guidance

A path is one ordinary fold: cost ≈ `paths × ticks × rules`, memory
≈ `paths × ticks × (stocks + derived)`. The CLI's 2000×240-path run is
seconds; a browser worker pool splits the range across cores. Prefer
percentiles (the summary is the answer — `paths × ticks` raw timelines are
big, which is why JSON export ships the summary, and the same seed
reproduces the paths on reload), and keep the deterministic run as your
debug view — no random model should be folded *because* a bug could be found
there faster than under a seed.

## Related

- [DSL reference — stochastic values](/reference/dsl#values-and-rates)
- [Branches guide](/guide/branches#same-world-monte-carlo-forks)
- [Outputs reference](/reference/outputs) — percentile table/CSV shapes
