# Concepts

Kairotron is a **discrete-time dynamical system** you write as text. Everything
else — the table, the chart, the fork, the Monte Carlo bands — is a view onto
one mechanism: a pure step function folded across a finite horizon. This page
is the mental model; the [DSL reference](/reference/dsl) is the letter of the
law.

## The fold

A model declares a finite **horizon** `(start, end, tickUnit)` — say 0..12 in
monthly ticks — and a **step function** built from rules. The runner computes:

```text
s₀ = initial stocks          (the snapshot at tick `start`)
s₁ = step(s₀, t=1)
s₂ = step(s₁, t=2)
...
sₙ = step(sₙ₋₁, t=end)

history = [S₀, S₁, …, Sₙ]    (append-only, all frozen)
```

```text
 model          fold                        timeline
┌──────────┐   sₜ = step(sₜ₋₁, t)   S₀ → S₁ → S₂ → … → Sₙ
│ horizon  │ ─────────────────────►  │    │    │         │
│ stocks   │                         └ all immutable, every delta carries
│ rules    │                           provenance (rule + source line)
└──────────┘
```

Two consequences matter everywhere else:

1. **Finite horizon.** The playhead walks to `end` and stops. There is no
   infinite loop — this is a `reduce` over ticks, not a scheduler.
2. **Immutability.** Snapshots are frozen and never rewritten. Scrubbing is a
   lookup, forking is a slice, and a Monte Carlo is N independent folds with
   no shared mutable state to race over.

The whole engine — `src/core/` — is pure and UI-free: types, fold, unit
conversion, calendar overlay, seeded randomness. The DSL layer (`src/dsl/`)
builds the rules; the outputs (`src/outputs/`) render tables/CSV; the CLI and
browser REPL are thin shells. No finance vocabulary anywhere: stocks are
whatever you name them.

## The value taxonomy

The system accounts for exactly three kinds of user values, plus built-ins:

| Kind | What it is | Who can change it |
|---|---|---|
| **Constants** | Fixed values; may *carry* a per-unit rate (`pct(7, "year")`) | Nobody during a run — varying them is a scenario/branch |
| **Variables (stocks)** | The state vector — named numeric stocks (`preTax`, `storage`, `susceptible`) | Only the fold, one snapshot at a time |
| **Derived values** | Read-only projections of (stocks, constants, `t`, earlier derived) | Nothing — they never feed the step |

- **Constants** stay constant: a rate's *value* never changes; only the
  engine's normalized application per tick does (`c.perTick("growth")`).
- **Stocks** evolve the way a dynamical system evolves: each snapshot *fixes*
  the value at `t`, computed from `sₜ₋₁`. Nothing is rewritten in place —
  the sequence of immutable values *is* the mutation.
- **Derived values** join every snapshot (`Sₜ` = stocks + derived) so scrubbing
  exposes both. The graph is acyclic by construction: a derivation may read
  stocks, constants, `t`, and derivations defined *earlier* — a forward or
  unknown reference throws at fold time. A "derived" value that influenced the
  step would be a rule, not a derivation.
- **Built-in readables** — `c.t` and the horizon context — are read-only
  everywhere. This is how date gating (`age >= 73`, computed from `t` + basis)
  works with no special-casing.

A rate constant is *not* in `c.constants` — read it through `c.perTick(name)`,
which hands you the value normalized to the current tick unit (see below).
Plain (unitless) constants live in `c.constants`.

## Ticks and units are semantics

Changing the tick unit is not changing the tempo — it changes what "one step"
means. Every rate carries `(value, perUnit)`, and the engine normalizes to the
tick at run time through a fixed day-count table:

```text
7%/year on monthly ticks  →  7/12  %/tick
7%/year on weekly ticks   →  7/52  %/tick
7%/year on daily ticks    →  7/364 %/tick  (abstract convention)
```

Flat amounts that should mean "per calendar time" are declared as rates too
(`rate(2750, "month")` = 2750 per month, applied per-tick-proportionally),
which is why re-ticking a *monthly* 2750 contribution to a *daily* grid gives
≈ 2750 ÷ 30.33 per day, not 2750 per day. Conversions that mix month/quarter/
year units with fixed-length units must land on **whole ticks** — durations
that don't divide cleanly are rejected, not fudged, under the declared
**day-count convention** (`abstract`, `actual/365`, `30/360`).

Full tables and rules: [Tick units & calendar](/guide/units-and-calendar).

## Abstract time, calendar as an overlay

Ticks are plain numbers by default; `day 73` means tick 73, nothing else. A
calendar is a **display/gating overlay**:

```ts
horizon: { start: 0, end: 1000, unit: "month", convention: "actual/365", basis: date("1975-06-15") }
```

`basis` anchors tick 0 to a civil moment. Then:

- `c.when(t)` / `c.date(t)` (or the free
  `when(t, unit, basis, convention)`) render any tick as a read-only calendar
  date — rules gate on `c.date().year >= 2044` the same way they gate on
  numbers;
- month/quarter/year ticks step the *civil* calendar (Jan 31 + 1 monthly tick
  → Feb 28/29, leap-true; clamped to the 30th under `30/360`);
- tables and CSV gain a `date` column, chart axes get calendar labels.

Nothing else changes. The fold stays tick-pure; dates never enter the state.
Every model works without a basis.

## Provenance: which line moved my stock?

Every delta a rule writes into a snapshot carries the rule's label and source
location — the analog of Strudel attaching `withLoc` to mini-notation events.
`--flows` prints it; in the REPL it is the whole point:

```text
t=42
       +2,750.00  preTax  monthly contribution  @model.ts:17:5
       +1,140.93  preTax  growth @ 7%/year      @model.ts:18:5
```

Scrub the playhead to t=42 and exactly those two lines light up in the editor.
Scrubbing answers "why is this bucket what it is?" by pointing at the code.

Locations are captured from the JavaScript stack at `flow()`/`transfer()` call
time (`captureLoc`) and mapped to editor lines in the browser by a
compile-time calibration; `mini()` statements map back to their own line in
the sugar block. See [Contributing → Provenance](/contributing#provenance-and-line-mapping).

## Branches: what-if for free

Because snapshots never mutate, `fork(history, t, variantModel)` shares the
prefix `S₀..Sₜ` by reference and folds the variant's rules onward — Git for
timelines. A variant may change constants, rules, stocks, even the **tick
unit** (the trunk prefix is re-expressed at the moments both grids agree, and
`lagged` reads that sparse prefix hold-last). In the REPL the Δ-pane plots
branch-minus-trunk per stock; in the CLI, `--diff` prints it.
See [Branches & what-if](/guide/branches).

## Deterministic by default, Monte Carlo on demand

A plain run folds the expected value even when the model declares randomness:

```ts
constants: { growth: stochastic(pct(7, "year"), normal(pct(15, "year"))) }
```

Sample it instead (`--mc N`, the REPL's **mc paths**) and each path is an
independent seeded fold: `path p of seed s` is reproducible from `(s, p)`
alone — no wall-clock, no scheduling order. Per-tick noise scales with
`√(tick/perUnit)`, so tick granularity doesn't change the spread; the output
is a percentile timeline (p10/p50/p90 by default). Forks with paths on are
*same-world*: each branch path continues its trunk path's own shock sequence,
so the band gap is the decision's effect with the noise held fixed.
See [Monte Carlo](/guide/monte-carlo).

## Share sessions vs saved scenarios

Both start from "model code + horizon/MC controls", and they answer different
questions:

- **Share URL** = the whole *session* — trunk code, horizon, MC inputs,
  playhead, and each branch's fork tick and buffer — compressed into one `?m=`
  query parameter. Branches ride as forks and replay on load. Serverless.
  Opening one runs the trunk code it carries, so treat a link like pasted
  script ([Share URLs](/guide/browser-repl#share-urls)).
- **Scenario sets** = named *variants* (code + controls, no playhead/branches)
  grouped into sets in `localStorage` — the spreadsheet-tabs notion of
  scenario. Loading one is an apply + re-run on a fresh trunk.

## The purity boundary

`src/core/` and `src/dsl/` never touch the DOM, the clock, or randomness
without a seed; the browser REPL imports the engine unchanged. Outputs are
pure string/JSON formatters over snapshot arrays. This boundary is why the
same model file runs in the CLI, in the browser editor, and in N workers with
identical numbers — and it is the contract contributors must keep
([Contributing guide](/contributing)).

