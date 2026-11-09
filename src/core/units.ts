import type { TickUnit } from "./types.js";

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

// Abstract-time convention: fixed ticks-per-year ratios (no calendar).
// Calendar-accurate day-count conventions (30/360, actual/actual, leap
// years) are a milestone-6 overlay on top of this table.
const TICKS_PER_YEAR: Readonly<Record<TickUnit, number>> = {
  year: 1,
  quarter: 4,
  month: 12,
  week: 52,
  day: 365,
  hour: 365 * 24,
  minute: 365 * 24 * 60,
  second: 365 * 24 * 60 * 60,
};

export function isTickUnit(name: string): name is TickUnit {
  return (TICK_UNITS as readonly string[]).includes(name);
}

// plan.md §3: a 7%/year rate is 7/12 per monthly tick, 7/52 per weekly tick.
export function normalizeRate(
  value: number,
  perUnit: TickUnit,
  tickUnit: TickUnit,
): number {
  return (value * TICKS_PER_YEAR[perUnit]) / TICKS_PER_YEAR[tickUnit];
}

// Interval length (not rate): how many tick-units fit in `value perUnit` —
// 1 quarter spans 3 monthly ticks, but only 0.25 yearly ticks.
export function ticksPerInterval(value: number, perUnit: TickUnit, tickUnit: TickUnit): number {
  return (value * TICKS_PER_YEAR[tickUnit]) / TICKS_PER_YEAR[perUnit];
}
