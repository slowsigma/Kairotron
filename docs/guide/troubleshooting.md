# Troubleshooting & FAQ

Every validation error is designed to name the offending value. This catalog
maps engine/CLI/REPL messages to causes and fixes. If a message isn't here,
it's verbatim searchable in `src/`.

## Model declaration

**`model requires a horizon: { start, end, unit }`**
`model({...})` without a `horizon` field. Add e.g.
`horizon: { start: 0, end: 12, unit: "month" }`.

**`unknown tick unit 'months' (expected one of: second, …)`**
Units are singular (`"month"`); same list applies to `every(rate(...))` and
the CLI `--unit`.

**`unknown day-count convention 'actual365' (expected one of: abstract, actual/365, 30/360)`**
The slash is part of the name.

**`a horizon with a calendar basis needs a calendar convention: set convention to "actual/365" or "30/360" (the "abstract" default has no civil calendar)`**
`basis` + `abstract` contradict — the abstract year (364 days) has no civil
calendar to anchor to. Set `convention`.

**`horizon.basis must be a finite timestamp — build it with date("YYYY-MM-DD")`**
A string or `Date` leaked into `basis`; wrap it: `basis: date("1975-06-15")`.

**`invalid date '2021-02-30' — that civil date/time does not exist`**
`date()` rejects impossible dates rather than rolling over to March.

**`horizon declares a calendar basis but runs under the 'abstract' convention`**
Same fix, folded at run time (a `run(model, override)` dropped the
convention).

**`stock 'x' initial value must be finite (got NaN)`**
A computation producing NaN/Infinity in `stocks`.

**`rule 'x' references unknown stock 'y'`**
Every stock any rule touches (through `when`/`every`/…) must be declared in
`stocks`. Declare it (initial 0 is fine) or fix the name — case-sensitive.

**`derived 'x' collides with a stock, constant, or built-in name`** /
**`duplicate derived name 'x'`** / **`derived name 't' is reserved`**
Derived names are a separate namespace layered on the stocks — they must be
new, unique, and not `t`.

## Rules & schedules

**`every() interval must be a positive whole number of ticks (got 0.5)`**
Numeric intervals are tick counts. For calendar intervals pass a rate:
`every(rate(1, "quarter"), …)`.

**`schedule interval 1/quarter does not land on a whole number of 'day' ticks (91.25) under the 'actual/365' day-count convention`**
The interval's duration doesn't divide the tick grid under that convention.
Fixes: choose a convention where it divides (`abstract`: 91, `30/360`: 90 —
90 and 91 are whole daily ticks), coarsen the tick unit, or keep the
schedule in unit terms it divides (`every(rate(13, "week"), …)`).

**`once() tick must be an integer`** / **`between() requires integer bounds with from <= to`** /
**`every() offset must be a non-negative integer tick`**
Schedules are integer-tick based (the `lagged() requires…` errors read alike).

**`rule 'growth' produced non-finite amount at t=37: NaN`**
A rule's expression went NaN — classic causes: a stock the rule divides by
hit 0, or `c.constants.foo` read for a *rate* constant (rates live behind
`c.perTick("foo")`, not `c.constants`).

**`lag references unknown stock 'foo'`** /
**`lag requires a whole number of ticks >= 1 (got 0)`**
`lag` reads committed snapshots of declared stocks; lag 0 means "now" — read
`c.stocks` instead. Reads before the first snapshot clamp to `S₀` (by design,
not an error).

**`no rate constant named 'growth'`**
`c.perTick` called for a plain constant (or a typo). Plain numbers are in
`c.constants`; rates and stochastic rates are `c.perTick`.

## Derived values

**`derived 'mix' reads unknown or forward-referenced derived 'total' (derivations must be acyclic; already defined: netWorth)`**
Order `derived` lines so every read targets an earlier definition; the
message lists what the expression could see.

**`derived 'x' produced non-finite value at t=12: NaN`**
Divide-by-zero or NaN state at that tick — fix the model (guard, `min(...)`
floor) or make the projection conditional on `c.t`.

**`derived 'x' cannot write to c.derived (read-only)`**
Derivations are projections; if a value should feed the fold, it's a rule.

## Calendar reads

**`rule at t=42: this model has no calendar basis — declare horizon.basis = date("YYYY-MM-DD") to read dates`**
`c.when()`/`c.date()` (or a guard reading date fields in the sugar) without a
basis. Add one, or gate on plain tick numbers.

**`when(t, unit, basis, convention): pass the model's day-count convention explicitly`**
The free `when` overload requires the 4th argument (it can't see the model to
guess); inside rules prefer the bound `c.when(t)` / `c.date(t)`.

**`calendar conversion needs a whole tick (got t=1.5)`**
Dates exist at whole ticks only — pass an integer.

## Re-ticking & conventions

**`horizon end = 1.09… 'month' ticks — not a whole number under the 'abstract' day-count convention`** (or
**`no whole 'month' tick at the same civil moment`** with a basis)
The requested duration doesn't divide the target grid. Pick bounds in the
target unit directly (`--end 13`, or explicit REPL start/end — raw ticks, no
duration preservation), or choose units/conventions that divide
([tick-units table](/guide/units-and-calendar#the-day-table)).

**`fork point t=6 maps to 182.5 'day' ticks, at or past the branch horizon end`** —
cross-unit forks must land the fork snapshot exactly; move the fork tick or
adjust the variant's horizon start.

## Branching

**`fork() requires a non-empty history to fork from`** — run the trunk first.

**`fork point t=7 is not in the history (0..6)`** — fork on a committed tick
(sparse cross-unit prefixes have holes; tick numbers must exist).

**`fork point t=6 is before the branch horizon start (8)`** — the variant's
horizon must cover its fork tick; **`… must be before the branch horizon end
(6) — nothing left to run`** — leave at least one tick past the fork.

**`a variant model may still introduce new stocks…`** (not an error): stocks
only the variant declares appear on the branch from its first folded tick;
the shared prefix shows `—` / empty.

## Monte Carlo

**`Monte Carlo paths must be a whole number >= 1`** /
**`Monte Carlo seed must be an integer`** /
**`percentile must be within 0..100`** — flag/input validation.

**`stochastic() requires a rate base, e.g. stochastic(pct(7, "year"), normal(pct(15, "year")))`** —
a plain number (or missing `pct`/`rate`) as base.

**`uniform() bounds must share the same per-unit (got 'year' and 'month')`** —
bound both in one unit.

**`normal() volatility must be a finite non-negative rate`** — negative σ
(signed noise isn't a σ).

**`forkMonteCarlo continues the trunk's world — seed N would splice a different shock sequence…`** —
omit the seed (branches inherit the trunk's) or start a fresh
`runPaths`/`fork` pair for a new world.

**`forkMonteCarlo requires the branch to keep the trunk's tick grid … A
re-ticked branch is a new random world`** — same unit, convention, and basis
as the trunk; for a stochastic cross-unit what-if, fork first and sample
each world separately.

**`path i has N snapshots, path 0 has M — timelines must share the tick grid`** —
you mixed timelines from differently-gridded runs into one
`summarizeMonteCarlo`.

**`--flows shows per-tick deltas of a single deterministic run; drop it with --mc`** (same for `--diff`) —
per-tick provenance is one-path; rerun deterministically for flows.

Browser-only cousins: **"Monte Carlo branches fork the trunk's paths — run
main with mc paths first"** (branch paths on, trunk paths off — set paths on
the trunk) and **"the trunk is deterministic again"** (a re-run dropped the
trunk's paths, so the MC branches can't re-fork).

## CLI & loading

**`<file> must default-export a model (built with model({...}) from src/dsl/model.ts)`**
Missing/incorrect `export default`.

**`cannot load 'model.ts': no TypeScript loader available (install tsx, or run via npx tsx src/cli.ts)`**
The compiled `bin/cli.js` without `tsx` resolvable; or run the source CLI
with `npx tsx src/cli.ts`.

**`--fork-at requires --variant (the model the branch continues with)`** —
as printed; pass both.

**Exit code 1 with only usage printed** — an unknown option, missing value,
non-integer `--end`/`--fork-at`, or two model files.

## Browser REPL

**`model code failed: <parse/compile error>`** — the buffer didn't compile;
the message is the JS engine's (line numbers shifted by the eval prologue —
count from the buffer's line 1).

**`model code must evaluate to model({ stocks, rules, ... })`** — the buffer
must *be* a `model({...})` expression (or a `mini`-built spec); `return`
statements and import lines are the usual culprits — constructors are already
in scope.

**`branches need the trunk — run main first`** — fork after a trunk run.

**`cannot fork here: the playhead has no matching trunk moment`** — the
playhead sits past the trunk's end (or before its start) on a re-ticked
branch; scrub back onto trunk time.

**`horizon end (X) must exceed start (Y)`** — explicit start/end fields in
the toolbar; fill both consistently (they're raw ticks in the selected unit).

**`bad share link: … — started from the sample`** — corrupted/truncated
`?m=` parameter (copy the whole URL; some clients wrap/truncate).

**`save failed: …`** — localStorage quota or blocked storage; scenario sets
degrade to empty.

## Mini-notation

Errors carry the resolved line: `mini: line 24: expected '+=', '-=', or '->'
after 'preTax' (line 24)`. Common ones: **`unknown name 'foo'`** (not a
constant/stock/rate/`t`/date field — `lag()`/`delta()` read stocks, not
constants), **`'~name = expr' declares a derived value — put it in a
miniDerived() block`**, **`unexpected ';' — one statement per line`**, and
**`invalid number '3kg'`** (`k` suffix followed by letters).

## FAQ

**Why do my yearly-tick results differ from monthly ones?** They're different
models semantically — per-tick rate application and once-per-tick amounts
changed meaning. This is [units as semantics](/guide/units-and-calendar),
not drift.

**Why is my `lagged` flat at the start?** Lags clamp at the leading edge:
reads before `S₀` return `S₀`, so early ticks see the initial state, not
errors.

**Why did my stochastic model print one number, not a distribution?** A
seedless run is *intended* to be the expected value. Sample
(`--mc N` / mc paths).

**Why didn't the fork inherit my variant's initial stocks?** From the fork
tick the trunk state wins; variant initials only *introduce* new stocks.

**Are `--seed` paths stable across versions?** Stable per engine version
(splitmix32 + Box-Muller + `pathSeed` are fixed); treat cross-version
reproduction as a pinned-version property.

**Why no code highlighting in Monte Carlo runs?** Deltas belong to one
deterministic path; the percentile view shows distributions. Switch paths off
(leave mc paths empty / drop `--mc`) to see per-line provenance again.
