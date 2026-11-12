import type {
  CalendarDate,
  DayCount,
  DerivedContext,
  DerivedDef,
  DistSpec,
  FlowRule,
  Guard,
  GuardedRule,
  Model,
  ModelSpec,
  Rate,
  Rule,
  ScheduledRule,
  SourceLocation,
  StochasticValue,
  TickContext,
  TickUnit,
  TransferRule,
} from "../core/types.js";
import { isCalendarConvention, parseDate, whenDate } from "../core/calendar.js";
import { DAY_COUNTS, TICK_UNITS, isDayCount, isTickUnit } from "../core/units.js";

type Amount = number | ((ctx: TickContext) => number);

function toAmountFn(a: Amount): (ctx: TickContext) => number {
  return typeof a === "number" ? () => a : a;
}

// Best-effort source mapping across engine stack formats without relying on
// engine internals: V8 frames are "at name (/path/file:line:col)" behind an
// "Error: msg" header line; Firefox is "name@/path/file:line[:col]" with no
// header; WebKit is "name@file:line[:col]". depth counts frames above captureLoc.
export function captureLoc(depth = 2): SourceLocation | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const frames = stack.split("\n").filter((l) => l.trim() !== "");
  if (frames.length === 0) return undefined;
  const header = /@|\bat /.test(frames[0]!) ? 0 : 1;
  const frame = frames[header + depth + 1];
  if (!frame) return undefined;
  const m = frame.match(/\(?([^\s()]+?):(\d+)(?::(\d+))?\)?\s*$/);
  if (!m) return undefined;
  // Firefox frames are "name@/path/file:line:col" — cut the name. Lazy token
  // above matters: with a greedy one and WebKit's optional column, the path
  // swallows ":line" and the reported values shift by one.
  const file = m[1]!.split("@").pop()!;
  return {
    file,
    line: Number(m[2]!),
    column: m[3] ? Number(m[3]) : 1,
  };
}

export function model(spec: ModelSpec): Model {
  const horizon = spec.horizon;
  if (!horizon) {
    throw new Error("model requires a horizon: { start, end, unit }");
  }
  if (!isTickUnit(horizon.unit)) {
    throw new Error(`unknown tick unit '${horizon.unit}' (expected one of: ${TICK_UNITS.join(", ")})`);
  }
  if (horizon.convention !== undefined && !isDayCount(horizon.convention)) {
    throw new Error(
      `unknown day-count convention '${horizon.convention}' (expected one of: ${DAY_COUNTS.join(", ")})`,
    );
  }
  if (horizon.basis !== undefined) {
    if (!Number.isFinite(horizon.basis)) {
      throw new Error(
        `horizon.basis must be a finite timestamp — build it with date("YYYY-MM-DD") (got ${horizon.basis})`,
      );
    }
    if (horizon.convention === undefined || !isCalendarConvention(horizon.convention)) {
      throw new Error(
        `a horizon with a calendar basis needs a calendar convention: set convention to "actual/365" or "30/360" (the "abstract" default has no civil calendar)`,
      );
    }
  }
  for (const [name, value] of Object.entries(spec.stocks)) {
    if (!Number.isFinite(value)) throw new Error(`stock '${name}' initial value must be finite (got ${value})`);
  }
  const seen = new Set(Object.keys(spec.stocks));
  for (const rule of spec.rules) {
    for (const target of stockRefs(rule)) {
      if (!seen.has(target)) throw new Error(`rule '${labelOf(rule)}' references unknown stock '${target}'`);
    }
  }
  const reserved = new Set([...Object.keys(spec.stocks), ...Object.keys(spec.constants ?? {}), "t"]);
  const seenDerived = new Set<string>();
  for (const def of spec.derived ?? []) {
    if (!def.name) throw new Error("derived() requires a non-empty name");
    if (reserved.has(def.name)) {
      throw new Error(`derived '${def.name}' collides with a stock, constant, or built-in name`);
    }
    if (seenDerived.has(def.name)) throw new Error(`duplicate derived name '${def.name}'`);
    seenDerived.add(def.name);
  }
  return {
    // Built-in readables are read-only: freeze the declared horizon so a rule
    // can never mutate the model's time base between or during runs.
    horizon: Object.isFrozen(horizon) ? horizon : Object.freeze({ ...horizon }),
    constants: spec.constants ?? {},
    stocks: spec.stocks,
    rules: spec.rules,
    derived: spec.derived ?? [],
  };
}

function labelOf(rule: Rule): string {
  switch (rule.kind) {
    case "flow":
    case "transfer":
      return rule.label;
    case "when":
    case "unless":
      return labelOf(rule.rule);
    case "on":
      return labelOf(rule.rule);
  }
}

export function stockRefs(rule: Rule): string[] {
  switch (rule.kind) {
    case "flow":
      return [rule.stock];
    case "transfer":
      return [rule.from, rule.to];
    case "when":
    case "unless":
    case "on":
      return stockRefs(rule.rule);
  }
}

export function flow(
  stock: string,
  amount: Amount,
  label: string,
  loc?: SourceLocation,
): FlowRule {
  const resolved = loc ?? captureLoc(1);
  return { kind: "flow", stock, amount: toAmountFn(amount), label, ...(resolved && { loc: resolved }) };
}

export function transfer(
  from: string,
  to: string,
  amount: Amount,
  label: string,
  loc?: SourceLocation,
): TransferRule {
  const resolved = loc ?? captureLoc(1);
  return { kind: "transfer", from, to, amount: toAmountFn(amount), label, ...(resolved && { loc: resolved }) };
}

export function rate(value: number, perUnit: TickUnit): Rate {
  if (!Number.isFinite(value)) throw new Error(`rate value must be finite (got ${value})`);
  if (!isTickUnit(perUnit)) throw new Error(`unknown unit '${perUnit}' (expected one of: ${TICK_UNITS.join(", ")})`);
  return { kind: "rate", value, perUnit };
}

export function pct(percent: number, perUnit: TickUnit): Rate {
  return rate(percent / 100, perUnit);
}

// Monte Carlo overlay (plan.md §6: deterministic by default, stochastic is
// opt-in). stochastic(base, dist) marks a rate constant as a random sequence;
// rules keep reading it through c.perTick(name), which yields the base rate's
// expected value in a deterministic run and a seeded realization per tick in
// a Monte Carlo run. normal is additive noise around the base, scaled to the
// tick by sqrt(tick/perUnit); uniform keeps its per-unit midpoint and scales
// the band's half-width the same way, so reticking does not change the spread.
export function normal(sd: Rate): DistSpec {
  if (!isRateValue(sd)) {
    throw new Error(`normal() requires a rate volatility, e.g. normal(pct(15, "year")) (got ${JSON.stringify(sd)})`);
  }
  if (!Number.isFinite(sd.value) || sd.value < 0) {
    throw new Error(`normal() volatility must be a finite non-negative rate (got ${sd.value})`);
  }
  return { kind: "normal", sd };
}

export function uniform(low: Rate, high: Rate): DistSpec {
  if (!isRateValue(low) || !isRateValue(high)) {
    throw new Error(`uniform() requires rate bounds, e.g. uniform(pct(2, "year"), pct(9, "year"))`);
  }
  if (!Number.isFinite(low.value) || !Number.isFinite(high.value)) {
    throw new Error(`uniform() bounds must be finite (got ${low.value}..${high.value})`);
  }
  if (low.value > high.value) {
    throw new Error(`uniform() requires low <= high (got ${low.value} > ${high.value})`);
  }
  if (low.perUnit !== high.perUnit) {
    throw new Error(
      `uniform() bounds must share the same per-unit (got '${low.perUnit}' and '${high.perUnit}')`,
    );
  }
  return { kind: "uniform", low, high };
}

export function stochastic(base: Rate, dist: DistSpec): StochasticValue {
  if (!isRateValue(base)) {
    throw new Error(`stochastic() requires a rate base, e.g. stochastic(pct(7, "year"), normal(pct(15, "year")))`);
  }
  if (!Number.isFinite(base.value)) {
    throw new Error(`stochastic() base rate must be finite (got ${base.value})`);
  }
  if (!dist || (dist.kind !== "normal" && dist.kind !== "uniform")) {
    throw new Error(`stochastic() dist must be normal(...) or uniform(...) (got ${JSON.stringify(dist)})`);
  }
  return { kind: "stochastic", base, dist };
}

function isRateValue(v: unknown): v is Rate {
  return typeof v === "object" && v !== null && (v as { kind?: string }).kind === "rate";
}

// `when` does double duty, by shape (plan.md §Core semantics):
// - when(guard, rule)   — gating (milestone 2)
// - when(t, unit, basis, convention) — the calendar overlay (milestone 7): a
//   tick rendered as a read-only CalendarDate for date gating/display.
//   `basis` is a date("...") timestamp (typically horizon.basis) and
//   `convention` is the model's day count. The convention is required: the
//   free function cannot see the model, and silently assuming actual/365
//   would make date gating disagree with a 30/360 fold. Inside a rule,
//   `c.when(t)` / `c.date(t)` are bound to the fold's own horizon and are the
//   safer idiom.
export function when(cond: Guard, rule: Rule, loc?: SourceLocation): GuardedRule;
export function when(
  t: number,
  unit: TickUnit,
  basis: number,
  convention: DayCount,
): CalendarDate;
export function when(
  a: Guard | number,
  b: Rule | TickUnit,
  basisOrLoc?: number | SourceLocation,
  convention?: DayCount,
): GuardedRule | CalendarDate {
  if (typeof a === "number") {
    if (typeof b !== "string" || !isTickUnit(b)) {
      throw new Error(
        `when(t, unit, basis): unknown tick unit '${String(b)}' (expected one of: ${TICK_UNITS.join(", ")})`,
      );
    }
    if (convention === undefined) {
      throw new Error(
        `when(t, unit, basis, convention): pass the model's day-count convention explicitly ` +
          `(e.g. when(t, unit, basis, c.horizon.convention)), or use the bound c.when(t) / c.date(t)`,
      );
    }
    if (!isDayCount(convention)) {
      throw new Error(
        `when(): unknown day-count convention '${convention}' (expected one of: ${DAY_COUNTS.join(", ")})`,
      );
    }
    return whenDate(a, b, basisOrLoc as number, convention);
  }
  const resolved = (basisOrLoc as SourceLocation | undefined) ?? captureLoc(1);
  return { kind: "when", guard: a, rule: b as Rule, ...(resolved && { loc: resolved }) };
}

// The basis constructor: a UTC civil timestamp for horizon.basis (tick 0's
// moment). Pure display overlay — engine semantics stay tick-pure.
export function date(input: string): number {
  return parseDate(input);
}

export function unless(cond: Guard, rule: Rule, loc?: SourceLocation): GuardedRule {
  const resolved = loc ?? captureLoc(1);
  return { kind: "unless", guard: cond, rule, ...(resolved && { loc: resolved }) };
}

export function every(
  interval: number | Rate,
  rule: Rule,
  offset = 0,
  loc?: SourceLocation,
): ScheduledRule {
  if (typeof interval === "number" && (!Number.isInteger(interval) || interval <= 0)) {
    throw new Error(`every() interval must be a positive whole number of ticks (got ${interval})`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`every() offset must be a non-negative integer tick (got ${offset})`);
  }
  const resolved = loc ?? captureLoc(1);
  return {
    kind: "on",
    schedule: { kind: "every", interval, offset },
    rule,
    ...(resolved && { loc: resolved }),
  };
}

export function once(tick: number, rule: Rule, loc?: SourceLocation): ScheduledRule {
  if (!Number.isInteger(tick)) {
    throw new Error(`once() tick must be an integer (got ${tick})`);
  }
  const resolved = loc ?? captureLoc(1);
  return { kind: "on", schedule: { kind: "once", tick }, rule, ...(resolved && { loc: resolved }) };
}

export function between(from: number, to: number, rule: Rule, loc?: SourceLocation): ScheduledRule {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new Error(`between() requires integer bounds with from <= to (got ${from}..${to})`);
  }
  const resolved = loc ?? captureLoc(1);
  return { kind: "on", schedule: { kind: "between", from, to }, rule, ...(resolved && { loc: resolved }) };
}

// Schedule semantics are integer-tick based; abstract time is the default.
// NOTE on delays: lag(n) reads the value n ticks ago, clamping at the leading
// edge — lookups landing before the horizon start read S0 (the initial state),
// so early-tick lags are defined rather than errors.

export function lagged(stock: string, ticks: number): (ctx: TickContext) => number {
  if (!Number.isInteger(ticks) || ticks < 1) {
    throw new Error(`lagged() requires a whole number of ticks >= 1 (got ${ticks})`);
  }
  return (c) => c.lag(stock, ticks);
}

export function laggedDelta(stock: string, ticks: number): (ctx: TickContext) => number {
  if (!Number.isInteger(ticks) || ticks < 1) {
    throw new Error(`laggedDelta() requires a whole number of ticks >= 1 (got ${ticks})`);
  }
  return (c) => c.lag(stock, ticks) - c.lag(stock, ticks + 1);
}

export function derived(
  name: string,
  expr: (ctx: DerivedContext) => number,
  loc?: SourceLocation,
): DerivedDef {
  if (!name) throw new Error("derived() requires a non-empty name");
  if (name === "t") throw new Error("derived name 't' is reserved (the built-in tick)");
  const resolved = loc ?? captureLoc(1);
  return { name, expr, ...(resolved && { loc: resolved }) };
}
