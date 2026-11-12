# Tick units & calendar

> Changing the tick unit is not changing the tempo; it changes what "one
> step" means. Rates must be unit-normalized, and day-count frictions need an
> explicit convention. — plan.md

## The day table

Every unit has a fixed length **in days** under each convention; all
conversions are ratios through days. Three day-count conventions exist:

| Unit | `abstract` (default) | `actual/365` | `30/360` |
|---|---|---|---|
| second | 1/86 400 | 1/86 400 | 1/86 400 |
| minute | 1/1 440 | 1/1 440 | 1/1 440 |
| hour | 1/24 | 1/24 | 1/24 |
| day | 1 | 1 | 1 |
| week | 7 | 7 | 7 |
| month | 364/12 (≈30.333) | 365/12 (≈30.417) | 30 |
| quarter | 91 | 365/4 (91.25) | 90 |
| year | **364** (= 52 exact weeks) | 365 | 360 |

The abstract year is exactly 52 weeks, so week↔day, quarter↔week, and
quarter↔day conversions land on whole ticks without a calendar. Months never
divide a year evenly under any convention — that friction is real, and the
engine refuses to hide it.

`abstract` has no civil calendar at all: a horizon `basis` requires
`actual/365` or `30/360`.

## Rate normalization

A rate constant `v perUnit` contributes `v × daysPerTick(tick) / daysPerTick(perUnit)`
per tick:

```ts run
import { normalizeRate } from "kairotron";

// 7%/year is 7/12 % per monthly tick, 7/52 % per weekly tick
const monthly = normalizeRate(0.07, "year", "month"); // 0.07 * 364 / (364/12)
const weekly = normalizeRate(0.07, "year", "week", "actual/365");

if (Math.abs(monthly - 0.07 / 12) > 1e-12) throw new Error(`monthly: ${monthly}`);
if (Math.abs(weekly - (0.07 * 7) / 365) > 1e-12) throw new Error(`weekly: ${weekly}`);
console.log({ monthly, weekly });
```

Inside rules you never call this — `c.perTick("growth")` applies it with the
fold's own unit and convention.

Schedule intervals use the inverse ratio (**interval length**, not rate): one
quarter spans 3 monthly ticks but only 0.25 yearly ticks, so
`every(rate(1, "quarter"), rule)` is legal on month ticks and illegal on
year ticks.

Both directions convert *through days*, so floating-point ratios like
12 × (365/12) come back as 4227.000000000001-style noise: durations within a
machine-epsilon-scaled tolerance of a whole tick are accepted as rounding
noise, and genuine fractions are rejected by name.

## Re-ticking a horizon

`retickHorizon` re-expresses `(start, end, unit)` on a new grid **preserving
duration** — tick numbers are durations measured from 0, so each bound is
converted through the day table (or, with a basis, through its civil moment).
Rates don't change in the model; their per-tick application re-normalizes at
fold time, which is the whole point:

```ts run
import { retickHorizon } from "kairotron";

const months = { start: 0, end: 12, unit: "month" as const };
const years = retickHorizon(months, "year"); // same duration: 0..1 yearly tick

// ...and the same model yields different numbers, because per-tick meaning moved:
// growth lands 7% per tick, not 7/12%, and a flat 2750 contribution is applied
// once, not twelve times.
console.log(years); // { start: 0, end: 1, unit: 'year', convention: 'abstract' }

// A duration that won't divide is rejected, not rounded:
try {
  retickHorizon({ start: 0, end: 1, unit: "month" }, "quarter");
  throw new Error("should have been rejected");
} catch (e) {
  if (!(e as Error).message.includes("whole")) throw e;
}
```

CLI: `--unit <unit>` triggers exactly this; `--end <n>` then overrides the
end bound in raw target-unit ticks (opting out of duration preservation for
that bound). In the REPL, the **unit** select does the same while start/end
stay on auto; explicit start/end are the raw-tick escape hatch.

## The calendar overlay

Abstract time is the default — ticks are plain numbers. A **basis** is a
display/gating overlay: the civil moment (epoch-ms, UTC) of tick 0, declared
with `date("YYYY-MM-DD")`:

```ts
horizon: { start: 0, end: 1000, unit: "month", convention: "actual/365", basis: date("1975-06-15") }
```

Rules then read `c.date()` / `c.when(t)` (or the free
`when(t, unit, basis, convention)`), tables gain a `date` column, and chart
axes render civil labels. Engine semantics never change: dates never enter
the state vector.

### Civil stepping (month / quarter / year ticks)

With a basis, month/quarter/year ticks are **civil lengths**, not day ratios:
tick *n* lands on the basis's day-of-month, *n* civil months later, with the
time-of-day carried across every step.

- `actual/365` steps leap-true: Jan 31 + one monthly tick → **Feb 28** (or 29
  in a leap year) — clamped to the shortest month, then back out. A yearly
  tick that crosses a leap day is 366 days long, and the fixed day ratio would
  have missed it.
- `30/360` first clamps the anchor day to 30 — a civil "month" never advances
  past the 30th. The anchor itself is *not* clamped: a 31st-of-March basis is
  tick 0 exactly; the clamp applies when stepping.
- Fixed units (second…week) always convert through the ratio table; every
  unit/convention pair lands on whole milliseconds, so a tick never splits
  one.

### Inverse reads and grid alignment

`msToTick` asks whether a civil moment is *on* the grid: fixed units return a
possibly fractional tick (callers round through the whole-tick tolerance);
civil month/quarter/year units return the exact whole tick or nothing — there
is no fractional civil month tick. Cross-unit forks and diffs with a basis
align by **civil moment**, not by a constant ratio, precisely because month
lengths are leap-true.

## Basis survival

The basis anchors tick 0 — a moment, not a duration — so:

- **re-ticks keep it**: `retickHorizon` carries `basis` unchanged (bounds
  re-anchor to their civil moments), and `--unit` in the CLI inherits the
  model's basis automatically;
- **forks inherit it**: a branch whose model declares no basis adopts the
  trunk's, so both timelines measure from the same civil moment even across
  units or a shifted horizon start;
- **snapshots carry it**: every snapshot records `unit`/`convention`/`basis`,
  which is how a branch can share a trunk's prefix while its own new ticks
  follow the variant model's basis.

## Worked example

A quarterly premium schedule on a monthly grid, then the same model on a
daily grid under two conventions:

```bash
# quarterly = 3 whole monthly ticks — fine
npx tsx src/cli.ts examples/retirement.ts ...

# a quarterly schedule on daily ticks: 91 days under abstract ✓,
# 90 under 30/360 ✓, but 91.25 under actual/365 — refused, not fudged
... --convention actual/365
```

The engine's message states the arithmetic (e.g. `schedule interval
1/quarter does not land on a whole number of 'day' ticks (91.25) under the
'actual/365' day-count convention`); switching convention or unit is the fix.

## Related

- [DSL reference — Horizon, units, conventions](/reference/dsl#horizon-units-conventions)
- [Branches guide](/guide/branches) — cross-unit forks and sparse prefixes
- [Troubleshooting](/guide/troubleshooting) — conversion rejections mapped
