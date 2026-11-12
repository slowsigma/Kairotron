import type { DayCount, TickUnit } from "./types.js";
import { convertTicksAt } from "./calendar.js";

export const TICK_UNITS: readonly TickUnit[] = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

export const DAY_COUNTS: readonly DayCount[] = ["abstract", "actual/365", "30/360"];

export const DEFAULT_DAY_COUNT: DayCount = "abstract";

// Every unit has a fixed length in days under each convention; all
// conversions are ratios through days. "abstract" is the calendar-free
// default: the abstract year is exactly 52 weeks = 4 quarters = 364 days, so
// week↔day (7), quarter↔week (13) and quarter↔day (91) land on whole ticks
// and schedule intervals across those pairs fire cleanly. Months stay
// 12/year (≈30.33 days — they never divide a real or abstract year evenly).
// "actual/365" counts the civil year at 365 days (months 365/12); "30/360"
// puts every month at exactly 30 days. Leap-year-true actual/actual depends
// on where a calendar basis sits — that is the milestone-7 overlay, not a
// ratio table.
const DAYS_PER_TICK: Readonly<Record<DayCount, Readonly<Record<TickUnit, number>>>> = {
  abstract: {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 364 / 12,
    quarter: 91,
    year: 364,
  },
  "actual/365": {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 365 / 12,
    quarter: 365 / 4,
    year: 365,
  },
  "30/360": {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30,
    quarter: 90,
    year: 360,
  },
};

export function isTickUnit(name: string): name is TickUnit {
  return (TICK_UNITS as readonly string[]).includes(name);
}

export function isDayCount(name: string): name is DayCount {
  return (DAY_COUNTS as readonly string[]).includes(name);
}

export function daysPerTick(unit: TickUnit, convention: DayCount = DEFAULT_DAY_COUNT): number {
  return DAYS_PER_TICK[convention][unit];
}

// plan.md §3: a 7%/year rate is 7/12 per monthly tick, 7/52 per weekly tick.
// A per-tick rate scales with the tick's share of the per-unit's span.
export function normalizeRate(
  value: number,
  perUnit: TickUnit,
  tickUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): number {
  return (value * daysPerTick(tickUnit, convention)) / daysPerTick(perUnit, convention);
}

// Interval length (not rate): how many tick-units fit in `value perUnit` —
// 1 quarter spans 3 monthly ticks, but only 0.25 yearly ticks.
export function ticksPerInterval(
  value: number,
  perUnit: TickUnit,
  tickUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): number {
  return (value * daysPerTick(perUnit, convention)) / daysPerTick(tickUnit, convention);
}

// Volatility (not rate): spread accrues over *time*, not linearly — a
// 15%/year sigma is 15/√12 %/month. Independent per-tick shocks with this
// scaling give the same outcome spread at any tick granularity, so Monte
// Carlo keeps "the tick unit is semantics" honest.
export function normalizeVolatility(
  value: number,
  perUnit: TickUnit,
  tickUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): number {
  return value * Math.sqrt(daysPerTick(tickUnit, convention) / daysPerTick(perUnit, convention));
}

// Duration-preserving tick conversion: tick numbers measured from 0 are
// durations, so reticking converts them through days.
export function convertTicks(
  ticks: number,
  fromUnit: TickUnit,
  toUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): number {
  return (ticks * daysPerTick(fromUnit, convention)) / daysPerTick(toUnit, convention);
}

// Floating-point ratios can be a hair off: 60 second ticks convert to
// 0.9999999999999999 minute ticks. Durations this close to a whole tick are
// rounding noise, not friction. Scale by machine epsilon, not a fixed 1e-9: at
// a billion second-ticks the old relative band silently accepted (and rounded)
// fractions of thousands of seconds. An absolute floor absorbs tiny
// ordinary-arithmetic noise.
const TICK_EPSILON_ABS = 1e-12;
const TICK_EPSILON_REL = 8 * Number.EPSILON;

// Round a tick count to the nearest whole tick, or undefined when it genuinely
// falls between ticks. Directions that convert through days (horizon re-ticks
// and schedule intervals) share this so both accept the same rounding noise.
export function nearestWholeTick(ticks: number): number | undefined {
  const rounded = Math.round(ticks);
  const tolerance = Math.max(TICK_EPSILON_ABS, TICK_EPSILON_REL * Math.max(1, Math.abs(ticks)));
  return Math.abs(ticks - rounded) <= tolerance ? rounded : undefined;
}

export function wholeTicks(
  ticks: number,
  what: string,
  toUnit: TickUnit,
  convention: DayCount,
): number {
  const rounded = nearestWholeTick(ticks);
  if (rounded === undefined) {
    throw new Error(
      `${what} = ${ticks} '${toUnit}' ticks — not a whole number under the '${convention}' day-count convention`,
    );
  }
  return rounded;
}

// Re-express a horizon in a different tick unit, preserving its duration.
// The convention override lets a UI convert under a newly chosen convention;
// otherwise the horizon keeps its own (default abstract). The basis anchors
// tick 0 (a moment, not a duration), so it survives re-ticking unchanged.
export function retickHorizon(
  horizon: { start: number; end: number; unit: TickUnit; convention?: DayCount | undefined; basis?: number | undefined },
  toUnit: TickUnit,
  convention?: DayCount,
): { start: number; end: number; unit: TickUnit; convention: DayCount; basis?: number | undefined } {
  const conv = convention ?? horizon.convention ?? DEFAULT_DAY_COUNT;
  if (toUnit === horizon.unit && convention === undefined) return { ...horizon, convention: conv };
  const basis = horizon.basis;
  const convertBound = (ticks: number, what: string): number => {
    // With a calendar basis, month/quarter/year ticks are civil lengths
    // (leap-true), so a fixed day-ratio conversion would shorten a year that
    // contains a leap day. Anchor the tick to its civil moment instead.
    const converted =
      basis === undefined
        ? convertTicks(ticks, horizon.unit, toUnit, conv)
        : convertTicksAt(ticks, horizon.unit, toUnit, basis, conv);
    if (converted === undefined) {
      throw new Error(
        `${what} = ${ticks} '${horizon.unit}' ticks — no whole '${toUnit}' tick at the same civil moment under the '${conv}' day-count convention`,
      );
    }
    return wholeTicks(converted, what, toUnit, conv);
  };
  return {
    start: convertBound(horizon.start, "horizon start"),
    end: convertBound(horizon.end, "horizon end"),
    unit: toUnit,
    convention: conv,
    ...(horizon.basis === undefined ? {} : { basis: horizon.basis }),
  };
}
