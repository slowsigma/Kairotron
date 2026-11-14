# Getting started

This tutorial takes you from a clean checkout to a running, scrubbed, re-ticked,
branched, Monte-Carlo'd, exported model — in the CLI and the browser REPL.
Every command is copy-pasteable; every model block below is extracted and run
in CI, so it cannot drift from the engine.

## Prerequisites

- **Node 20.19+** (22+ recommended) and npm.
- No global installs — `tsx` comes from the repo's dependencies, and `vite` and
  `vitest` from its dev dependencies.

## Install

```bash
git clone <your-kairotron-remote> && cd kairotron
npm install
npm test        # the full suite; every example model is verified tick-by-tick
```

## Run a model in the CLI

The fastest orientation is someone else's model — a monthly retirement
cashflow (`examples/retirement.ts`):

```bash
npx tsx src/cli.ts examples/retirement.ts
```

```text
  t      preTax       cash   ~netWorth  ~preTaxShare
--  ----------  ---------  ----------  ------------
  0  120,000.00  25,000.00  145,000.00          0.83
  1  123,466.04  25,031.25  148,497.29          0.83
  2  126,952.30  25,062.54  152,014.84          0.84
  ...
```

One row per **tick**: tick 0 is the initial state, and each following tick is
the result of applying the model's rules once. Stocks are plain columns;
`~`-prefixed columns are **derived values** — read-only projections like
net worth, never inputs to the fold.

Add `--flows` and every delta names the rule (and source line) that wrote it:

```bash
npx tsx src/cli.ts examples/retirement.ts --flows
```

```text
t=1
       +2,750.00  preTax       monthly contribution  @/path/to/repo/examples/retirement.ts:17:5
         +716.04  preTax       growth @ 7%/year  @/path/to/repo/examples/retirement.ts:18:5
          +31.25  cash         interest @ 1.5%/year  @/path/to/repo/examples/retirement.ts:19:5
```

The CLI prints source paths as absolute filenames; they are shortened here.
This **provenance** is what powers code highlighting in the browser REPL —
the CLI just prints it raw.

## Write your first model

A model is a TypeScript file that default-exports `model({...})`: a horizon,
constants, stocks (the state), rules (the deltas), and derived values.
Save this as `solar.ts` and run `npx tsx src/cli.ts solar.ts`:

```ts
import { derived, flow, model, pct } from "kairotron";

export default model({
  horizon: { start: 0, end: 10, unit: "day" },
  constants: {
    harvest: 40,          // kWh stored each day
    load: 15,             // kWh consumed each day (display only)
    drain: pct(2, "day"), // 2% of the charge is lost per day
  },
  stocks: {
    battery: 10,
  },
  rules: [
    flow("battery", (c) => c.constants.harvest, "harvest"),
    flow("battery", (c) => -c.stocks.battery * c.perTick("drain"), "self-discharge"),
  ],
  derived: [derived("daysOfCover", (c) => c.stocks.battery / c.constants.load)],
});
```

But a model is just data — you can also fold it yourself and inspect the
snapshots. This snippet is fully runnable (it is in CI):

```ts run
import { derived, flow, formatTable, model, pct, run } from "kairotron";

const solar = model({
  horizon: { start: 0, end: 10, unit: "day" },
  constants: {
    harvest: 40,
    load: 15,
    drain: pct(2, "day"),
  },
  stocks: {
    battery: 10,
  },
  rules: [
    flow("battery", (c) => c.constants.harvest, "harvest"),
    flow("battery", (c) => -c.stocks.battery * c.perTick("drain"), "self-discharge"),
  ],
  derived: [derived("daysOfCover", (c) => c.stocks.battery / c.constants.load)],
});

const history = run(solar);
console.log(formatTable(history));

if (history.length !== 11) throw new Error(`expected 11 snapshots, got ${history.length}`);
if (Math.abs(history[1]!.stocks.battery! - 49) > 1e-9) {
  throw new Error(`unexpected t=1 battery: ${history[1]!.stocks.battery}`);
}
```

What just happened:

- `flow("battery", fn, "label")` writes a delta into the `battery` stock each
  tick. The function reads the tick context `c` — the stocks so far this tick,
  the constants, `c.t`, and `c.perTick(name)` for rates.
- Rules apply **in order within a tick**: the discharge rule sees the post-
  harvest balance, so t=1 is `(10 + 40) × 0.98 = 49`.
- The tick unit is `day` and the drain is declared `pct(2, "day")`, so
  `c.perTick("drain")` is exactly 2% per tick. Change the horizon to weekly
  ticks and the same constant means ~14% per tick — see
  [Tick units & calendar](/guide/units-and-calendar).
- History is `[S0 … S10]`: frozen snapshots, each carrying its stocks, derived
  values, and labeled deltas. Nothing is mutated in place.

## Open the browser REPL

```bash
npm run dev
```

The REPL opens with a sample model loaded. Press **▶ Run** (or Ctrl+Enter) —
the editor holds model code, the stacked chart holds the fold:

1. Run the sample, then **drag the playhead** across the chart (or use
   `←`/`→`). The editor highlights *the lines whose rules moved a stock at
   that tick*; the inspector tab lists stocks, this tick's flows, and derived
   values.
2. Click a **legend swatch** to hide/show a stock.
3. Switch **stocks** to `lines`, flip the table tab to the raw fold, and press
   **CSV** / **JSON** to export.

The full tour — fork, Monte Carlo bands, share URLs, scenario sets — is in the
[Browser REPL guide](/guide/browser-repl).

## Re-tick: change the meaning, keep the duration

The tick unit is semantics. Re-express the year-long monthly model on a yearly
grid:

```bash
npx tsx src/cli.ts examples/retirement.ts --unit year
```

```text
t      preTax       cash   ~netWorth  ~preTaxShare
-  ----------  ---------  ----------  ------------
0  120,000.00  25,000.00  145,000.00          0.83
1  131,342.50  25,375.00  156,717.50          0.84
```

0..12 monthly ticks became 0..1 yearly tick — the same *duration*. The 7%/year
growth rate now lands as 7% per tick instead of 7/12%, and the flat 2750
contribution is applied once instead of twelve times: `131,342.50` after one
yearly tick is not `162,953.22` after twelve monthly ticks. That difference is
the point — [units are semantics](/guide/units-and-calendar).

## Fork a what-if

States are immutable, so branching is free. `retirement-boost.ts` continues
the same model from tick 6 with the contribution lifted 2750 → 3500 and the
horizon stretched to 24 months:

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
  9  +2,276.35  +0.00
 ...
```

The branch's ticks 0..6 are the trunk's *same frozen snapshots*; the Δ table
is the what-if's answer. See [Branches & what-if](/guide/branches).

## Monte Carlo: sample the noise

Deterministic by default — a stochastic model's plain run is its expected
value. To see the distribution, sample seeded paths:

```bash
npx tsx src/cli.ts examples/retirement-mc.ts --mc 200 --seed 1 --percentiles 5,50,95
```

```text
monte carlo — 200 paths × 240 ticks · seed 1
  t   preTax·p5    preTax·p50    preTax·p95    cash·p5   cash·p50   cash·p95  ~netWorth·p5  ~netWorth·p50  ~netWorth·p95
---  ----------  ------------  ------------  ---------  ---------  ---------  ------------  -------------  -------------
  0  120,000.00    120,000.00    120,000.00  25,000.00  25,000.00  25,000.00    145,000.00     145,000.00     145,000.00
240  743,991.80  1,624,913.26  3,661,190.37  33,740.15  33,740.15  33,740.15    777,731.95   1,658,653.41   3,694,930.52
```

The `cash` columns collapse everywhere (nothing random touches them); the
`preTax` band is the 7%/15% growth at work. Same seed + same path count = the
same numbers, bit for bit. In the browser, set **mc paths** in the toolbar and
the chart swaps to percentile bands. See [Monte Carlo](/guide/monte-carlo).

## Export, share, and save

From the REPL:

- **CSV / JSON** download the current timeline (percentile tables in Monte
  Carlo mode; `kairotron.json` carries the full snapshot history — see
  [Outputs & exports](/reference/outputs)).
- **Share** encodes the whole session — model, horizon, Monte Carlo inputs,
  playhead, and every branch — into the URL (`?m=…`). Anyone opening it gets
  the same fold and re-forked branches. No server. A share link runs the
  model code it carries, so treat one like a pasted script — see
  [Share URLs](/guide/browser-repl#share-urls).
- **💾 Save** files the model + controls as a named scenario in a scenario
  set (`localStorage`), selectable from the **scenario** dropdown.

## Common first errors

| Message | Meaning |
|---|---|
| `model requires a horizon: { start, end, unit }` | `model()` has no `horizon` field |
| `unknown tick unit 'months'` | units are singular: `month`, not `months` |
| `rule '...' references unknown stock '...'` | a rule names a stock you didn't declare |
| `schedule interval 1/minute does not land on a whole number of 'month' ticks` | the interval can't be expressed on the tick grid under the chosen convention — see the [troubleshooting catalog](/guide/troubleshooting) |

More in [Troubleshooting & FAQ](/guide/troubleshooting).

## Next steps

- [Concepts](/guide/concepts) — the fold, the value taxonomy, provenance.
- [Cookbook](/guide/cookbook) — reservoirs, SIR epidemics, dosing, supply
  chains, gating windows.
- [DSL reference](/reference/dsl) — every construct, precisely.
