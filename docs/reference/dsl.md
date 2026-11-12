# DSL reference

Kairotron's DSL is **embedded TypeScript** (Strudel-style): a model file
default-exports `model({...})` built from the constructors below, imported
from the package (`"kairotron"`), from `src/dsl/model.js` in-repo, or with the
constructors pre-bound in the browser REPL. A terse sugar front end
(`mini()` / `miniDerived()`) transpiles to the exact same objects —
see the [mini-notation reference](/reference/mini-notation).

## Quick reference

| Construct | Purpose |
|---|---|
| `model({ horizon, constants, stocks, rules, derived })` | Declare a model (validates eagerly) |
| `horizon: { start, end, unit, convention?, basis? }` | Finite tick range + optional day-count & calendar anchor |
| `date("YYYY-MM-DD")` | UTC civil timestamp for `horizon.basis` |
| `rate(v, unit)` / `pct(p, unit)` | Rate constant carrying its per-unit (`pct(7, "year")`) |
| `stochastic(base, dist)` | Rate constant that is a random sequence (`normal` / `uniform`) |
| `flow(stock, amount, label)` | Delta added to one stock each tick |
| `transfer(from, to, amount, label)` | Amount moved between stocks (two deltas) |
| `when(guard, rule)` / `unless(guard, rule)` | Gating |
| `every(n, rule, offset?)` | Recurring schedule (`offset` defaults to 0) |
| `once(t, rule)` | One-shot event at tick `t` |
| `between(a, b, rule)` | Window `a ≤ t ≤ b` |
| `lagged(stock, n)` / `laggedDelta(stock, n)` | Read `stock` `n` ticks back / its per-tick delta then |
| `derived(name, expr)` | Read-only projection attached to every snapshot |
| `when(t, unit, basis, convention)` | Free calendar read: tick → `CalendarDate` |
| `c.*` | Rule context (`t`, `stocks`, `constants`, `perTick`, `lag`, `when`, `date`, …) |
| `mini(source)` / `miniDerived(source)` | Sugar blocks → the same Rule/DerivedDef objects |

## Model shape

```ts
import { derived, flow, model, pct } from "kairotron";

export default model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: {
    contribution: 2750,          // plain number → c.constants.contribution
    growth: pct(7, "year"),      // rate → read via c.perTick("growth")
  },
  stocks: {
    preTax: 120000,              // initial value of each named stock (S₀)
    cash: 25000,
  },
  rules: [
    flow("preTax", (c) => c.constants.contribution, "monthly contribution"),
    flow("preTax", (c) => c.stocks.preTax * c.perTick("growth"), "growth"),
  ],
  derived: [
    derived("netWorth", (c) => c.stocks.preTax + c.stocks.cash),
  ],
});
```

`model()` requires `horizon`, `stocks`, and `rules` and validates the whole
model *at declaration time*:

- the `unit` must be a known tick unit and `convention` a known day count;
- a `basis` requires a calendar convention (`"actual/365"` or `"30/360"`, never
  `"abstract"`) and must be a finite timestamp — build it with `date("...")`;
- every stock initial value must be finite;
- every stock a rule (transitively through `when`/`unless`/`every`/`once`/
  `between`) touches must be declared;
- derived names must be non-empty, unique, and must not collide with a stock,
  constant, or the built-in `t`;
- the declared horizon is **frozen** — a rule that tries to mutate `c.horizon`
  throws in strict mode and can never change the engine mid-run.

`stocks` initial values must be finite numbers. Stocks may carry any user
name; the engine's null-prototype internals mean `__proto__` is a legal,
ordinary stock name.

## Horizon, units, conventions

```ts
interface Horizon {
  start: number;               // first tick (conventionally 0)
  end: number;                 // last tick — integer bounds, end ≥ start
  unit: TickUnit;              // second | minute | hour | day | week | month | quarter | year
  convention?: DayCount;       // abstract | actual/365 | 30/360 (default abstract)
  basis?: number;              // date("YYYY-MM-DD") — civil moment of tick 0
}
```

Units are **singular** words. The convention governs how month/quarter/year
map onto days for conversion and gating; `abstract` (the default) is a
364-day year — 52 exact weeks — so week/quarter/day grids divide cleanly
without a calendar. `basis` requires a calendar convention. Details and the
full day table: [Tick units & calendar](/guide/units-and-calendar).

## Values and rates

### `rate(value, perUnit): Rate` / `pct(percent, perUnit): Rate`

A rate constant: a fixed value carrying the unit it accrues *per*.
`pct(7, "year")` is `rate(0.07, "year")`. The value never varies — the engine
normalizes its *per-tick application* through the day-count table:

```ts
constants: { inflow: rate(180, "month") }   // 180 ML per month
// on daily ticks: c.perTick("inflow") = 180 / daysPerTick(month) per day
```

Rate constants are **not** in `c.constants`; read them with
`c.perTick(name)`, which throws `no rate constant named '…'` for a plain
number or a missing name.

### `stochastic(base, dist): StochasticValue`

Marks a rate constant as a random sequence — Monte Carlo mode only. Rules keep
reading it through the same `c.perTick(name)`:

- deterministic run (no seed): the **expected value** — the base rate, or the
  midpoint of a `uniform` band;
- seeded Monte Carlo run: a per-tick draw, scaled to the tick by
  `√(tick/perUnit)` so tick granularity never changes the outcome spread.

### `normal(sd)` and `uniform(low, high)`

```ts
constants: {
  growth: stochastic(pct(7, "year"), normal(pct(15, "year"))), // additive N(0, σ²) per tick
  yieldLo:  stochastic(pct(5, "year"), uniform(pct(2, "year"), pct(9, "year"))), // band around the midpoint
}
```

`normal(sd)` — additive noise around the base with per-unit volatility `sd`
(scaled per tick by `sqrt`; σ/year → σ/√12 per monthly tick).
`uniform(low, high)` — i.i.d. per-tick draw in a per-unit band; the midpoint
is the expected rate and the half-width scales like a σ. Bounds must be rates
sharing one `perUnit`, with `low.value ≤ high.value`.

## Rules

Rules are pure deltas: they compute amounts, never mutate. Each carries its
label and captured source location (provenance).

### `flow(stock, amount, label)`

Adds `amount` to `stock` every tick. `amount` is a number or
`(c: TickContext) => number` (must be finite — a NaN/Infinity amount is a
fold-time error naming the rule and tick). `+=` in mini-notation, with `-=`
negating.

```ts
flow("storage", (c) => -c.stocks.storage * c.perTick("evap"), "evaporation")
```

### `transfer(from, to, amount, label)`

Moves `amount` — subtracts from `from`, adds to `to`, emitting two deltas with
the same label/location. This is the conservation-friendly idiom (SIR, cash
sweeps); `->` in mini-notation. Amounts may be negative (flow reverses), and
nothing forces non-negativity unless you gate it:

```ts
transfer("inventory", "sold", (c) => Math.min(c.constants.demand, c.stocks.inventory), "demand")
```

### Gating: `when(guard, rule)` / `unless(guard, rule)`

Wraps any rule; the inner rule applies only when the guard passes at that
tick. Guards are `(c: TickContext) => boolean`. `when`/`unless`/`every`/
`between` nest freely (`when(g1, unless(g2, every(4, flow(...))))`):

```ts
when((c) => c.t >= 120, flow("cash", 200, "pension starts")),
unless((c) => c.stocks.inventory <= 0, flow("inventory", -50, "drawdown")),
```

### Schedules: `every` / `once` / `between`

Integer-tick semantics on abstract time:

| Schedule | Fires |
|---|---|
| `every(n, rule, offset?)` | `t ≥ offset` and `(t − offset) % n === 0` |
| `every(rate, rule, offset?)` | interval normalized to ticks first — must land on a whole tick count |
| `once(t, rule)` | exactly `t === tick` |
| `between(a, b, rule)` | every `a ≤ t ≤ b` (inclusive; `a ≤ b` required) |

```ts
every(7, transfer("susceptible", "recovered", (c) => c.constants.jabs, "weekly vaccination"))
every(rate(1, "quarter"), flow("cash", premium, "quarterly premium"), 3)
```

A rate interval that doesn't divide the tick grid under the horizon's
convention is rejected with a named error (`schedule interval … does not land
on a whole number of … ticks`).

### Delays: `lagged` / `laggedDelta` / `c.lag`

```ts
flow("inventory", laggedDelta("sold", 2), "ship last week's sales")
```

`lagged(stock, n)` is `(c) => c.lag(stock, n)` — the stock's value `n` ticks
ago (`n ≥ 1`, whole). `laggedDelta(stock, n)` is `lag(stock, n) − lag(stock, n+1)`
— the amount it moved in the tick ending `n` ticks ago. Lags read the committed
history with **hold-last** semantics and clamp at the leading edge: lookups
before the first snapshot read `S₀` (or the trunk's `S₀` through a fork).
Across a cross-unit fork the shared prefix is sparse and lag reads it as it
was in force at that moment.

### The tick context `c` (rules)

Read-only (`Object.freeze`d); writes throw:

| Member | Type / meaning |
|---|---|
| `c.t` | current tick |
| `c.stocks` | stock values so far *this tick* — rules that ran earlier this tick are visible |
| `c.constants` | plain (non-rate) constants |
| `c.horizon` | the frozen horizon |
| `c.tickUnit` | the horizon's unit |
| `c.perTick(name)` | rate (or stochastic draw) normalized to the tick |
| `c.lag(stock, n)` | stock value `n` ticks back (hold-last, clamped at `S₀`) |
| `c.date(t?)` | tick (default: now) as `CalendarDate` — throws without a basis |
| `c.when(t?)` | same, bound to the horizon's unit/convention/basis |

`c.stocks` being rule-order-aware is what lets `transfer` pairs and staged
flows compose predictably within a tick.

## Derived values

```ts
derived("fillFraction", (c) => c.stocks.storage / c.constants.capacity)
```

Evaluated at every snapshot from `DerivedContext`: `t`, `stocks`, `constants`,
`horizon`, `tickUnit`, `perTick`, `date`, `when` — plus `c.derived` for
*earlier* definitions (the acyclic rule; forward/unknown reads throw). A
derivation that produces a non-finite number is a fold-time error naming the
tick and the name. Derivations never see `lag` — rules move the system,
derivations only read it.

## Calendar values

```ts
const BIRTH = date("1975-06-15");          // horizon.basis: tick 0's civil moment

export default model({
  horizon: { start: 0, end: 1000, unit: "month", convention: "actual/365", basis: BIRTH },
  // ...
  rules: [
    when((c) => c.date().year >= 2048, flow("cash", 750, "RMD month")),
  ],
});
```

- `date(input)` parses `"YYYY-MM-DD"` (optionally `"YYYY-MM-DDTHH:MM[:SS]"`
  or `"YYYY-MM-DD HH:MM[:SS]"`, UTC) into epoch-ms, rejecting dates that don't
  exist (`2021-02-30`, month 13) rather than rolling over.
- `c.when(t?)` / `c.date(t?)` are the horizon-bound reads — preferred in rules;
  they use the fold's own unit/convention/basis and throw a clear message when
  the model declares no basis.
- `when(t, unit, basis, convention)` is the free overload — for reading a tick
  as a date outside a rule context (its `t` need not be the current tick, and
  the basis need not be the horizon's). The convention argument is
  **required**: the free function can't see the model, and silently assuming
  `actual/365` would make date gating disagree with a `30/360` fold.

A `CalendarDate` is read-only: `{ year, month (1–12), day, hours, minutes,
seconds, iso, ms }`.

## Reserved names and collisions

- `t` is reserved everywhere: not a legal stock, constant, or derived name.
- A derived name may not collide with a stock or constant.
- Rule labels are free-form strings (they appear in `--flows` output, the
  inspector, and highlighting), but each rule's *stock references* must be
  declared up front — variants may only introduce *new* stocks from the fork
  tick onward.

## Provenance and how highlighting works

Every `flow`/`transfer`/`when`/`every`/… call captures the caller's stack
frame (`captureLoc`), across V8/Firefox/WebKit stack formats. Deltas written
into snapshots carry `{ rule, loc }`; the browser REPL maps `loc.line` back to
editor lines with a calibration probe (the model code runs via
`new Function`, whose wrapper shifts stack lines), and `mini()` offsets each
statement's line by the block's call-site line. The CLI prints the location
after the rule label in `--flows`; the REPL lights the editor line at the
current playhead — Strudel's `withLoc` trick pointed at data.

## Related

- [Mini-notation reference](/reference/mini-notation) — the sugar grammar
- [Units & calendar guide](/guide/units-and-calendar) — conversion semantics
- [Embedding guide](/guide/embedding) — folding/branching programmatically
- [Troubleshooting](/guide/troubleshooting) — every validation error, mapped
