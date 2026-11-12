import type { CalendarDate, DayCount, TickUnit } from "./types.js";
import { DEFAULT_DAY_COUNT, daysPerTick, nearestWholeTick } from "./units.js";

// The milestone-7 overlay: a calendar basis is a display/gating anchor — the
// civil moment of tick 0 — that never changes engine semantics. Ticks stay
// plain numbers inside the fold; this module only maps tick numbers to civil
// dates (and back, via duration) for `when(...)` gating and display.

export const MS_PER_DAY = 86_400_000;

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

// The calendar-conventions are the declared finance ones; "abstract" has no
// civil calendar (a 364-day year), so a basis must not use it.
export const CALENDAR_CONVENTIONS: readonly DayCount[] = ["actual/365", "30/360"];

export function isCalendarConvention(name: DayCount): boolean {
  return CALENDAR_CONVENTIONS.includes(name);
}

// Parses "YYYY-MM-DD" (optionally "THH:MM[:SS]" or " HH:MM[:SS]") as a UTC
// civil timestamp, rejecting fields that don't exist rather than rolling over
// (2021-02-30, month 13, year 0050 via Date.UTC's 1900-shift — the round-trip
// check fails).
export function parseDate(input: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input.trim());
  if (!m) {
    throw new Error(
      `invalid date '${input}' — expected 'YYYY-MM-DD' (optionally 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD HH:MM', UTC)`,
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hours = m[4] === undefined ? 0 : Number(m[4]);
  const minutes = m[5] === undefined ? 0 : Number(m[5]);
  const seconds = m[6] === undefined ? 0 : Number(m[6]);
  const ms = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hours ||
    d.getUTCMinutes() !== minutes ||
    d.getUTCSeconds() !== seconds
  ) {
    throw new Error(`invalid date '${input}' — that civil date/time does not exist`);
  }
  return ms;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// m1 is 1-based (civil month numbering).
function daysInCivilMonth(y: number, m1: number): number {
  const table = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[m1 - 1]!;
}

// Civil month/quarter/year stepping from a basis: tick n lands on the basis's
// day-of-month, n civil months later, clamped to months too short to hold it
// (Jan 31 + 1 monthly tick → Feb 28/29 — leap-year-true actual/actual, the
// friction the ratio table can't express). Under 30/360 the anchor day is
// first clamped to 30, so a "month" never advances past the 30th. The basis's
// time-of-day carries across every step.
function civilStep(basis: number, nMonths: number, clampTo30: boolean): number {
  // Tick 0 *is* the declared basis — including a 31st-of-month basis under
  // 30/360, whose clamp applies when stepping, not to the anchor itself.
  if (nMonths === 0) return basis;
  const base = new Date(basis);
  const total = base.getUTCFullYear() * 12 + base.getUTCMonth() + nMonths;
  const y = Math.floor(total / 12);
  const mo0 = total - y * 12;
  const anchor = clampTo30 ? Math.min(base.getUTCDate(), 30) : base.getUTCDate();
  const day = Math.min(anchor, daysInCivilMonth(y, mo0 + 1));
  return Date.UTC(
    y,
    mo0,
    day,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds(),
  );
}

// How many civil months one tick of `unit` spans (0 for fixed-length units).
const monthsPerTick = (unit: TickUnit): number =>
  unit === "month" ? 1 : unit === "quarter" ? 3 : unit === "year" ? 12 : 0;

// Tick → civil timestamp under a declared convention:
// - month/quarter/year with a calendar convention step the civil calendar
//   directly (a monthly tick is a civil month, not 30.42 days);
// - everything else converts through the ratio table, which lands on whole
//   milliseconds for every unit/convention pair (abstract months included:
//   364/12 days = exactly 2,620,800 s), so a tick never splits a millisecond.
export function tickToMs(
  t: number,
  unit: TickUnit,
  basis: number,
  convention: DayCount = "actual/365",
): number {
  if (!Number.isFinite(basis)) {
    throw new Error(
      `calendar basis must be a finite timestamp — build it with date("YYYY-MM-DD") (got ${basis})`,
    );
  }
  if (!Number.isInteger(t)) {
    throw new Error(`calendar conversion needs a whole tick (got t=${t})`);
  }
  const months = monthsPerTick(unit);
  if (months > 0 && convention !== DEFAULT_DAY_COUNT) {
    return civilStep(basis, t * months, convention === "30/360");
  }
  return Math.round(basis + t * daysPerTick(unit, convention) * MS_PER_DAY);
}

// Inverse of tickToMs for a known civil moment. Fixed-length units (second …
// week) return a possibly-fractional tick count — callers round it through
// nearestWholeTick, matching the ratio-table conversion. Civil month/quarter/
// year units return the exact whole tick when the moment lands on the grid, and
// undefined otherwise (there is no fractional civil month tick).
export function msToTick(
  ms: number,
  unit: TickUnit,
  basis: number,
  convention: DayCount = "actual/365",
): number | undefined {
  if (!Number.isFinite(basis)) {
    throw new Error(
      `calendar basis must be a finite timestamp — build it with date("YYYY-MM-DD") (got ${basis})`,
    );
  }
  if (!Number.isFinite(ms)) return undefined;
  const months = monthsPerTick(unit);
  if (months > 0 && convention !== DEFAULT_DAY_COUNT) {
    const base = new Date(basis);
    const d = new Date(ms);
    const diff =
      (d.getUTCFullYear() - base.getUTCFullYear()) * 12 + (d.getUTCMonth() - base.getUTCMonth());
    if (diff % months !== 0) return undefined;
    const n = diff / months;
    return tickToMs(n, unit, basis, convention) === ms ? n : undefined;
  }
  return (ms - basis) / (daysPerTick(unit, convention) * MS_PER_DAY);
}

// Duration-preserving tick conversion that respects the civil calendar when a
// basis exists: the source tick is first anchored to its civil moment, then
// mapped back onto the target grid. This is the basis-aware counterpart of
// units.convertTicks (which uses fixed day ratios).
export function convertTicksAt(
  ticks: number,
  fromUnit: TickUnit,
  toUnit: TickUnit,
  basis: number,
  convention: DayCount = "actual/365",
): number | undefined {
  return msToTick(tickToMs(ticks, fromUnit, basis, convention), toUnit, basis, convention);
}

// Largest whole target tick at or before `ms` — the civil-calendar analog of
// floor((ms - basis) / tickLength), used for hold-last alignment of a
// re-ticked branch against its trunk. Fixed units keep the fractional tick
// semantics via floor; civil units walk the (monotonic) month grid.
export function tickAtOrBefore(
  ms: number,
  unit: TickUnit,
  basis: number,
  convention: DayCount = "actual/365",
): number {
  if (!Number.isFinite(basis)) {
    throw new Error(
      `calendar basis must be a finite timestamp — build it with date("YYYY-MM-DD") (got ${basis})`,
    );
  }
  if (!Number.isFinite(ms)) throw new Error(`calendar conversion needs a finite timestamp (got ${ms})`);
  const months = monthsPerTick(unit);
  if (months > 0 && convention !== DEFAULT_DAY_COUNT) {
    const base = new Date(basis);
    const d = new Date(ms);
    const diff =
      (d.getUTCFullYear() - base.getUTCFullYear()) * 12 + (d.getUTCMonth() - base.getUTCMonth());
    let n = Math.floor(diff / months);
    // Clamping and time-of-day can put the estimate one tick off; walk to the
    // true floor. The grid is monotonic, so this settles immediately.
    while (tickToMs(n + 1, unit, basis, convention) <= ms) n++;
    while (tickToMs(n, unit, basis, convention) > ms) n--;
    return n;
  }
  const raw = (ms - basis) / (daysPerTick(unit, convention) * MS_PER_DAY);
  const rounded = nearestWholeTick(raw);
  return rounded !== undefined ? rounded : Math.floor(raw);
}

export function formatCalDate(ms: number): string {
  const d = new Date(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (h === 0 && mi === 0 && s === 0) return date;
  const time = s === 0 ? `${pad(h)}:${pad(mi)}` : `${pad(h)}:${pad(mi)}:${pad(s)}`;
  return `${date} ${time}`;
}

export function calDate(ms: number): CalendarDate {
  const d = new Date(ms);
  return Object.freeze({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    iso: formatCalDate(ms),
    ms,
  });
}

// The calendar read used by `c.when(t)` / `c.date(t)` and the free
// `when(t, tickUnit, basis, convention)`: render a tick in calendar terms.
// The convention is the model's declared day count; actual/365 is the default
// because a basis without a convention means "the civil calendar".
export function whenDate(
  t: number,
  unit: TickUnit,
  basis: number,
  convention: DayCount = "actual/365",
): CalendarDate {
  return calDate(tickToMs(t, unit, basis, convention));
}
