# CLI reference

```text
usage: kairotron <model.ts> [options]

options:
  --csv            print CSV instead of the table
  --flows          also print per-tick deltas with rule provenance
  --unit <unit>    re-tick the horizon to a new unit (duration-preserving,
                   rates re-normalized; --end overrides the converted end)
  --convention <c> day-count convention for unit conversions
                   (abstract, actual/365, 30/360; default abstract)
  --end <n>        override the horizon end tick
  --fork-at <t>    fork a what-if branch at tick t (from <variant>)
  --variant <file> model file the branch continues with
  --diff           also print the branch's per-tick delta vs the trunk
  --mc <paths>     Monte Carlo: fold <paths> stochastic paths and
                   print the percentile table instead of a single run
  --seed <n>       Monte Carlo seed (default 1; same seed, same paths)
  --percentiles <p> Monte Carlo percentiles, comma-separated
                   (default 10,50,90)

units: second, minute, hour, day, week, month, quarter, year
```

## Running it

From a checkout:

```bash
npx tsx src/cli.ts examples/retirement.ts
# or through the npm script ("run": "tsx src/cli.ts"):
npm run run -- examples/retirement.ts
```

The `kairotron` bin entry (`bin/cli.js`) is the same CLI compiled with
`npm run build:bin`; a packaged install (`npm pack` / a future npm publish)
would register it as an executable.

## Model files

A model file must **default-export** a `Model` built with `model({...})`:

```ts
import { model } from "kairotron";
export default model({ horizon: {...}, stocks: {...}, rules: [...] });
```

Loading is a dynamic `import()` of the file, so TypeScript models need a TS
loader. The CLI registers `tsx`'s ESM hook itself when it can (`tsx` is a
dependency), so `node bin/cli.js model.ts` works after `npm run build:bin`, and
`npx tsx src/cli.ts model.ts` works from a checkout. Without any loader
available, `.ts` models fail with a hint to install tsx; plain `.js` models
load without one. Anything else the file exports is ignored.

## Options

### `--csv`

Switches the timeline output to RFC 4180 CSV (quoted fields where user stock
names need it). With `--mc`, emits the percentile CSV. See
[Outputs & exports](/reference/outputs) for column shapes.

### `--flows`

After the table, prints each tick's deltas: signed amount, stock, rule label,
and source location — the provenance that drives highlighting. Incompatible
with `--mc` (deltas belong to one deterministic fold).

### `--unit <unit>` — re-tick

Re-expresses the horizon on a new grid, **preserving duration**: tick numbers
are durations from 0, converted through the day-count table (`--convention`,
default `abstract`). `0..12` months becomes `0..1` year; rates re-normalize
at fold time, so results legitimately differ from the original grid — the
tick unit is semantics. Bounds that don't land on whole target ticks are
rejected rather than rounded; pair with `--end` to opt out. The horizon's
`basis` (if any) anchors tick 0 and survives unchanged.

### `--convention <c>`

Overrides the model's day-count convention for the conversion: `abstract`
(364-day year — week/quarter/day divide cleanly), `actual/365`, or `30/360`.
Conversions that assume a calendar (quarterly schedules on daily ticks, etc.)
can land on whole ticks under one convention and not another — where they
don't, the run is rejected with the arithmetic in the message.

### `--end <n>`

Overrides the horizon end with a raw tick count **in the target unit**,
skipping duration preservation for that bound. `--unit day --end 30` gives
exactly 30 daily ticks regardless of the model's original duration.

### `--fork-at <t> --variant <file>` [`--diff`]

Folds the trunk, then continues the fold from snapshot `t` with the variant
model — the shared prefix is the same immutable snapshots. The variant's own
horizon sets the branch end (a what-if may run past the trunk). A variant on
a different tick unit re-expresses the shared prefix at the moments both
grids agree (snapshots in between drop out; `lagged` reads them hold-last).
`--diff` adds a `Δ vs trunk (branch − trunk)` table after the fork tick,
aligned by duration across units. `--fork-at` without `--variant` is a usage
error.

### `--mc <paths>` [`--seed <n>`] [`--percentiles <p>`]

Folds `paths` seeded Monte Carlo paths of the model and prints the percentile
timeline instead of a single history. Paths must be a whole number ≥ 1;
default seed 1; default percentiles `10,50,90` (any 0..100 values, comma-
separated). The CLI folds paths sequentially — the fold is pure, so the
browser offloads path ranges to a worker pool instead; results are identical
per `(seed, path)`. Incompatible with `--flows` and `--diff` (both are
single-path views). Combined with `--fork-at`/`--variant` it runs the
same-world branch: each branch path continues its trunk path's shock
sequence (the branch must keep the trunk's tick grid).

## Exit codes & errors

| Code | When |
|---|---|
| `0` | success (also `-h`/`--help`, which prints usage to stderr) |
| `1` | usage error (unknown option, bad flag value, missing/multiple model files), load failure, or a fold-time model error |

Fold/validation messages are printed as authored by the engine (e.g.
`schedule interval 1/minute does not land on a whole number of 'month' ticks
(60.00000000000001) under the 'actual/365' day-count convention`) — the
[troubleshooting catalog](/guide/troubleshooting) maps each one to a cause.

## Recipes

```bash
# Yearly grid, explicit 3-year length, 30/360 day counting
npx tsx src/cli.ts examples/retirement.ts --unit year --end 3 --convention 30/360

# What-if fork with the per-tick deltas of the branch after the fork
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-boost.ts --flows --diff

# Cross-unit fork: the same year continued on daily ticks
npx tsx src/cli.ts examples/retirement.ts --fork-at 6 \
  --variant examples/retirement-daily.ts --diff

# Monte Carlo, 500 paths, percentile table (CSV on stdout for scripting)
npx tsx src/cli.ts examples/retirement-mc.ts --mc 500 --seed 1 --csv > mc.csv

# Calendar model: date column in the table
npx tsx src/cli.ts examples/rmd-calendar.ts --end 900
```

## Related

- [Outputs & exports](/reference/outputs) — what the printed shapes contain
- [Browser REPL guide](/guide/browser-repl) — the same horizon controls as
  toolbar fields
