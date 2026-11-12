# Branches & what-if

A what-if is a **fork**: continue the fold from any committed snapshot with a
different model. Because snapshots are frozen, the branch *shares* the trunk's
prefix — forking copies nothing, and re-running the trunk re-forks branches as
a fresh fold rather than a merge.

## CLI

```bash
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-boost.ts --diff
```

```text
branch 'retirement-boost.ts' — forked at t=6
 t      preTax       cash   ~netWorth  ~preTaxShare
--  ----------  ---------  ----------  ------------
  6  141,101.90  25,188.09  166,289.98          0.85
  7  145,445.41  25,219.57  170,664.98          0.85
 ...
Δ vs trunk (branch − trunk)
 t    ΔpreTax  Δcash
--  ---------  -----
  7    +754.38  +0.00
  8  +1,513.15  +0.00
```

The variant file default-exports its own model; only what it *changes*
matters. Conventions that fall out of the design:

- **Variant stocks are placeholders.** From the fork tick the trunk's state
  wins; a variant's initial stock values only *introduce new stocks*, which
  enter at their declared value on the branch's first folded tick (never
  retroactively at the fork point). Table/CSV print `—`/empty for them in the
  shared prefix.
- **The variant's horizon sets the branch end** — a what-if may run past the
  trunk's horizon (the boost model runs 0..24 while the trunk ends at 12).
- **The Δ table starts after the fork** — the shared prefix is diff-zero by
  construction — and marks `—` where there's nothing to subtract (a new stock,
  or a tick past the trunk's end).

## Programmatic fork

`fork(history, atT, variantModel, spec?)` returns a `Branch`
(`{ label, forkT, forkTBranch, horizon, snapshots }`). The optional
`spec.stocks` rewrites the fork snapshot itself — a one-tick intervention
(the `fork @t=…` deltas carry that provenance):

```ts run
import { derived, flow, fork, model, pct, run } from "kairotron";

const trunk = model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: { contribution: 2750, growth: pct(7, "year") },
  stocks: { pot: 10000 },
  rules: [
    flow("pot", (c) => c.constants.contribution, "contribution"),
    flow("pot", (c) => c.stocks.pot * c.perTick("growth"), "growth"),
  ],
  derived: [derived("doubled", (c) => c.stocks.pot * 2)],
});

const variant = model({
  ...trunk,
  constants: { contribution: 3500, growth: pct(7, "year") },
});

const history = run(trunk);
const branch = fork(history, 6, variant, { label: "raise" });

// the prefix is literally shared — same frozen objects, zero copying
if (branch.snapshots[3] !== history[3]) throw new Error("prefix must be shared by reference");
// the variant diverges from the fork tick onward
if (!(branch.snapshots[7]!.stocks.pot! > history[7]!.stocks.pot!)) throw new Error("branch should lead after the raise");
// the trunk is untouched by the what-if
if (history.length !== 13) throw new Error("trunk must be final");
console.log(branch.label, branch.forkT, "→", branch.snapshots.length - 1, "ticks");
```

A fork at `t` must be a tick in the history, inside the branch horizon, and
strictly before its end ("nothing left to run" otherwise). `lagged` reads
across the fork point into the shared trunk history.

## Re-ticked branches

A branch may continue on a **different tick unit** — the branch horizon names
the new unit, and the shared prefix is re-expressed by duration: each trunk
snapshot is placed at the branch tick of equal elapsed time (with a basis, by
civil moment), and snapshots whose moment doesn't land on a whole branch tick
have no representable position and drop out. The result is a **sparse
prefix**; `lag(stock, n)` reads it hold-last — the value in force as of the
queried moment — and the fork point itself must land exactly (a what-if has
to happen at a real branch tick).

```bash
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-daily.ts --diff
```

```text
branch 'retirement-daily.ts' — forked at t=6 (= t=182 day)
  t      preTax       cash   ~netWorth  ~preTaxShare
---  ----------  ---------  ----------  ------------
  0  120,000.00  25,000.00  145,000.00          0.83
 91  130,458.90  25,093.87  155,552.77          0.84
182  141,101.90  25,188.09  166,289.98          0.85
183  141,219.71  25,189.12  166,408.83          0.85
```

Six monthly ticks became exactly days 0 and 91 and 182 — months 1, 2, 4, 5
land *between* daily ticks and drop out; months 0, 3, 6 land exactly. The
variant declares its contribution as `rate(2750, "month")`, so it
re-normalizes to ≈ 90.65/day. `--diff` aligns the trunk by duration
(hold-last) across the scale change. The branch **inherits the trunk's
basis** unless it declares its own.

## In the REPL

**⑂ Fork** at the playhead → new chip, own editor buffer, shared prefix; the
Δ-pane plots branch-minus-trunk, the trunk ghosts behind as dashed lines.
Trunk re-runs re-fork branches at their original ticks; incompatible forks are
dropped and reported. Forking *from* a re-ticked branch maps the playhead to
the trunk's moment in force, not the tick number. Full details:
[Browser REPL guide](/guide/browser-repl).

## Same-world Monte Carlo forks

With paths on, `forkMonteCarlo(trunkResult, atT, variant)` forks *each
path*: path *i* continues the state **and the shock sequence** its trunk path
had at the fork tick (the fold replays the prefix's draws). The band gap is
then the decision's effect with the noise held fixed. Constraint: the branch
must keep the trunk's tick grid (unit, convention, basis) — a re-ticked branch
draws a different world, and the engine rejects the splice rather than mixing
shock sequences. Use plain `fork` + a fresh `runPaths` for a re-ticked
stochastic what-if.

```bash
npx tsx src/cli.ts examples/retirement-mc.ts --mc 500 --seed 1 \
  --fork-at 120 --variant examples/retirement-mc-cautious.ts
```

## Sharing branches

Share URLs carry branches as *forks*, not histories: fork tick + buffer (+
own horizon when re-ticked). Opening a link re-folds the trunk and replays
each fork — the same machinery as a trunk-edit re-fork.
([Browser REPL guide → Share URLs](/guide/browser-repl#share-urls))

## Related

- [Concepts](/guide/concepts#branches-what-if-for-free) — why forks are free
- [Monte Carlo guide](/guide/monte-carlo) — same-world forks in detail
- [Embedding guide](/guide/embedding) — the full `fork` signature
