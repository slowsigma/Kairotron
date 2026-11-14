# Embedding the engine

The core is a pure, embeddable library — no DOM, no clock, no network, no
hidden randomness. The CLI, the browser REPL, and the Monte Carlo worker pool
are all thin shells over the same exports; you can be too.

## Import

The package isn't published to the npm registry — the intended flow is to
clone the repo and run your code inside it (or reference the clone as a
path/git dependency of yours):

```bash
git clone <your-kairotron-remote> && cd kairotron && npm install
```

```ts
// everything: types, fold, units, calendar, DSL, sugar, formatters
import { model, flow, run, formatTable } from "kairotron";

// or module by module, relative to the clone:
import { fork, run as runFold } from "../src/core/fold.js";
```

`"kairotron"` is the repo's `tsconfig.json` `paths` alias for `src/index.ts`;
`tsx` resolves it for any program run inside the clone — that is how the
docs' runnable examples execute. In an outside project, point the alias at
the clone the same way:

```json
"paths": { "kairotron": ["/path/to/kairotron/src/index.ts"] }
```

## Core shapes

```ts
interface Horizon { start: number; end: number; unit: TickUnit;
                    convention?: DayCount; basis?: number }
type TickUnit = "second"|"minute"|"hour"|"day"|"week"|"month"|"quarter"|"year"
type DayCount = "abstract"|"actual/365"|"30/360"

interface Snapshot {           // frozen; one per tick
  t: number; unit: TickUnit; convention?: DayCount; basis?: number;
  stocks: Readonly<Record<string, number>>;   // the state vector
  derived: Readonly<Record<string, number>>;  // read-only projections
  deltas: readonly Delta[];    // { stock, amount, rule, loc? } — provenance
}

interface Branch { label: string; forkT: number; forkTBranch: number;
                   horizon: Horizon; snapshots: readonly Snapshot[] }

interface MonteCarloResult { seed: number; paths: number; horizon: Horizon;
                             timelines: readonly (readonly Snapshot[])[] }
```

Fold results — histories, snapshots, branches, and Monte Carlo results — are
`Object.freeze`d (with null-prototype internals where names are user-chosen);
embedding code can share snapshots freely. A `Model` itself is an ordinary
object, though its `horizon` is frozen.

## Entry points

| Call | Purpose |
|---|---|
| `run(model, horizonOverride?)` | fold → `readonly Snapshot[]` (the append-only history) |
| `fork(history, atT, variant, spec?)` | branch from any snapshot; `spec: { horizon?, stocks?, label?, rng? }` |
| `retickHorizon(horizon, unit, convention?)` | duration-preserving re-tick (throws on fractional ticks) |
| `runPaths(model, { paths, seed?, horizon? })` | Monte Carlo: N seeded folds → `MonteCarloResult` |
| `runPathRange(model, { seed, from, to, horizon? })` | paths `[from, to)` — the slice a worker pool takes |
| `forkMonteCarlo(trunk, atT, variant, spec?)` | same-world fork of a `MonteCarloResult` (grid must match) |
| `summarizeMonteCarlo(mc, percentiles?)` | percentile timeline (`PercentileSummary`) |
| `snapAtOrBefore(history, t)` | hold-last read (binary search; correct on sparse cross-unit prefixes) |

The formatters are plain functions: `formatTable`, `formatCsv`,
`formatFlows`, `formatDiff`, `formatPercentileTable`, `formatPercentileCsv`,
plus `percentile(sorted, p)` if you're aggregating yourself. Calendar bits:
`tickToMs`, `msToTick`, `tickAtOrBefore`, `formatCalDate`, `whenDate`.
Randomness is exposed and reproducible: `Rng` (splitmix32 + Box-Muller),
`pathSeed(seed, path)`.

## Building your own output

A formatter is a function over snapshots. Custom reports shouldn't touch the
engine at all:

```ts run
import { derived, flow, model, pct, run } from "kairotron";

const m = model({
  horizon: { start: 0, end: 8, unit: "quarter" },
  constants: { deposit: 1000, growth: pct(6, "year") },
  stocks: { pot: 5000 },
  rules: [
    flow("pot", (c) => c.constants.deposit, "deposit"),
    flow("pot", (c) => c.stocks.pot * c.perTick("growth"), "growth"),
  ],
  derived: [derived("gain", (c) => c.stocks.pot - 5000 - 1000 * c.t)],
});

// sparklines over the stock, straight from the snapshot array
const spark = "▁▂▃▄▅▆▇█";
const series = run(m).map((s) => s.stocks.pot!);
const min = Math.min(...series), max = Math.max(...series);
const bar = (v: number): string =>
  spark[Math.round(((v - min) / (max - min)) * (spark.length - 1))];
const line = series.map(bar).join("");
console.log(`pot ${series[0]} → ${series[series.length - 1]} ${line}`);

if (!/^[▁▂▃▄▅▆▇█]{9}$/.test(line)) throw new Error("sparkline malformed");
for (let i = 1; i < line.length; i++) if (line[i]! < line[i - 1]!) throw new Error("must be monotone growth");
// deposit then growth, in rule order: (5000 + 1000) × (1 + 6%/4)
if (Math.abs(series[1]! - 6090) > 1e-9) throw new Error(`t=1: ${series[1]}`);
```

(The `derived` context reads `c.t` — same read-only built-in the rules see.)

## Folding without the DSL

`Model` is a plain object satisfying `ModelSpec` (its `horizon` is frozen);
you can construct it by hand — or generate it from your own schema — and call
`run()` directly. The DSL layer (`model()`, `flow()`, …) only adds validation and
provenance capture; a hand-built rule simply has no `loc`, and every view
degrades gracefully (`--flows` prints the rule label with no `@location`).

## A note on purity

`src/core/` and `src/dsl/` do not read an ambient clock (`Date.now()`), use
`Math.random`, or touch the DOM or Node APIs: the same compiled module runs in
Node (CLI), in a browser tab, and in a module worker, and any two of them
produce bit-identical histories for the same input. If you're extending the
engine, keep it that way — the contract is enforced socially in review and
structurally by the worker-pool and jsdom tests
([Contributing guide](/contributing)).

## Related

- [DSL reference](/reference/dsl) — declaring models
- [Outputs reference](/reference/outputs) — the built-in formatters' shapes
- [Monte Carlo guide](/guide/monte-carlo) — `runPaths`/`runPathRange` semantics
