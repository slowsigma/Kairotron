import type {
  FlowRule,
  Guard,
  GuardedRule,
  Model,
  ModelSpec,
  Rate,
  Rule,
  ScheduledRule,
  SourceLocation,
  TickContext,
  TickUnit,
  TransferRule,
} from "../core/types.js";
import { TICK_UNITS, isTickUnit } from "../core/units.js";

type Amount = number | ((ctx: TickContext) => number);

function toAmountFn(a: Amount): (ctx: TickContext) => number {
  return typeof a === "number" ? () => a : a;
}

function captureLoc(depth = 2): SourceLocation | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const frame = stack.split("\n")[depth + 2];
  if (!frame) return undefined;
  const m = frame.match(/\(?([^\s()]+:\d+:\d+)\)?\s*$/);
  if (!m?.[1]) return undefined;
  const [file, line, column] = m[1].split(":");
  if (!file || !line || !column) return undefined;
  return { file, line: Number(line), column: Number(column) };
}

export function model(spec: ModelSpec): Model {
  const horizon = spec.horizon;
  if (!horizon) {
    throw new Error("model requires a horizon: { start, end, unit }");
  }
  if (!isTickUnit(horizon.unit)) {
    throw new Error(`unknown tick unit '${horizon.unit}' (expected one of: ${TICK_UNITS.join(", ")})`);
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
  return { horizon, constants: spec.constants ?? {}, stocks: spec.stocks, rules: spec.rules };
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

export function when(cond: Guard, rule: Rule): GuardedRule {
  const loc = captureLoc(1);
  return { kind: "when", guard: cond, rule, ...(loc && { loc }) };
}

export function unless(cond: Guard, rule: Rule): GuardedRule {
  const loc = captureLoc(1);
  return { kind: "unless", guard: cond, rule, ...(loc && { loc }) };
}

export function every(interval: number | Rate, rule: Rule, offset = 0): ScheduledRule {
  if (typeof interval === "number" && (!Number.isInteger(interval) || interval <= 0)) {
    throw new Error(`every() interval must be a positive whole number of ticks (got ${interval})`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`every() offset must be a non-negative integer tick (got ${offset})`);
  }
  const loc = captureLoc(1);
  return {
    kind: "on",
    schedule: { kind: "every", interval, offset },
    rule,
    ...(loc && { loc }),
  };
}

export function once(tick: number, rule: Rule): ScheduledRule {
  if (!Number.isInteger(tick)) {
    throw new Error(`once() tick must be an integer (got ${tick})`);
  }
  const loc = captureLoc(1);
  return { kind: "on", schedule: { kind: "once", tick }, rule, ...(loc && { loc }) };
}

export function between(from: number, to: number, rule: Rule): ScheduledRule {
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new Error(`between() requires integer bounds with from <= to (got ${from}..${to})`);
  }
  const loc = captureLoc(1);
  return { kind: "on", schedule: { kind: "between", from, to }, rule, ...(loc && { loc }) };
}

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
