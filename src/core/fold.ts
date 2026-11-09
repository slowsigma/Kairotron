import type {
  ConstValue,
  Delta,
  Horizon,
  Model,
  Rate,
  Rule,
  ScheduleSpec,
  Snapshot,
  StockMap,
  TickContext,
  TickUnit,
} from "./types.js";
import { normalizeRate, ticksPerInterval } from "./units.js";

function isRate(v: ConstValue): v is Rate {
  return typeof v === "object" && v !== null && v.kind === "rate";
}

export function scheduleIntervalTicks(
  interval: number | Rate,
  tickUnit: TickUnit,
): number {
  const ticks =
    typeof interval === "number"
      ? interval
      : ticksPerInterval(interval.value, interval.perUnit, tickUnit);
  if (!Number.isInteger(ticks) || ticks <= 0) {
    const shown = typeof interval === "number" ? `${interval}` : `${interval.value}/${interval.perUnit}`;
    throw new Error(
      `schedule interval ${shown} does not land on a whole number of '${tickUnit}' ticks (${ticks})`,
    );
  }
  return ticks;
}

export function scheduleFires(spec: ScheduleSpec, t: number, tickUnit: TickUnit): boolean {
  switch (spec.kind) {
    case "every": {
      const n = scheduleIntervalTicks(spec.interval, tickUnit);
      return t >= spec.offset && (t - spec.offset) % n === 0;
    }
    case "once":
      return t === spec.tick;
    case "between":
      return t >= spec.from && t <= spec.to;
  }
}

export function run(model: Model, horizonOverride?: Horizon): readonly Snapshot[] {
  const horizon = horizonOverride ?? model.horizon;
  if (!horizon) throw new Error("model has no horizon and none was passed to run()");
  const { start, end } = horizon;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`horizon bounds must be integer tick counts (got ${start}..${end})`);
  }
  if (end < start) {
    throw new Error(`horizon end (${end}) must be >= start (${start})`);
  }

  const plainConstants: Record<string, number> = {};
  const rateConstants: Record<string, Rate> = {};
  for (const [name, value] of Object.entries(model.constants)) {
    if (isRate(value)) rateConstants[name] = value;
    else plainConstants[name] = value;
  }

  let stocks: Record<string, number> = { ...model.stocks };
  const history: Snapshot[] = [];

  const freeze = (t: number, values: StockMap, deltas: readonly Delta[]): Snapshot =>
    Object.freeze({
      t,
      stocks: Object.freeze({ ...values }),
      deltas: Object.freeze(deltas.map((d) => Object.freeze({ ...d }))),
    });

  history.push(freeze(start, stocks, []));

  for (let t = start + 1; t <= end; t++) {
    const next: Record<string, number> = { ...stocks };
    const deltas: Delta[] = [];

    const makeCtx = (): TickContext =>
      Object.freeze({
        t,
        stocks: Object.freeze({ ...next }),
        constants: Object.freeze({ ...plainConstants }),
        horizon,
        tickUnit: horizon.unit,
        perTick(name: string): number {
          const rate = rateConstants[name];
          if (!rate) throw new Error(`no rate constant named '${name}'`);
          return normalizeRate(rate.value, rate.perUnit, horizon.unit);
        },
        lag(stock: string, ticks: number): number {
          if (!Number.isInteger(ticks) || ticks < 1) {
            throw new Error(`lag requires a whole number of ticks >= 1 (got ${ticks})`);
          }
          const committed = history.length - 1;
          const index = Math.min(Math.max(t - ticks - start, 0), committed);
          const value = history[index]?.stocks[stock];
          if (value === undefined) {
            throw new Error(`lag references unknown stock '${stock}'`);
          }
          return value;
        },
      });

    const applyRule = (rule: Rule, ctx: TickContext): void => {
      switch (rule.kind) {
        case "when":
          if (rule.guard(ctx)) applyRule(rule.rule, ctx);
          return;
        case "unless":
          if (!rule.guard(ctx)) applyRule(rule.rule, ctx);
          return;
        case "on":
          if (scheduleFires(rule.schedule, t, horizon.unit)) applyRule(rule.rule, ctx);
          return;
        case "flow": {
          const amount = rule.amount(ctx);
          if (!Number.isFinite(amount)) {
            throw new Error(`rule '${rule.label}' produced non-finite amount at t=${t}: ${amount}`);
          }
          next[rule.stock] = (next[rule.stock] ?? 0) + amount;
          deltas.push({ stock: rule.stock, amount, rule: rule.label, ...(rule.loc && { loc: rule.loc }) });
          return;
        }
        case "transfer": {
          const amount = rule.amount(ctx);
          if (!Number.isFinite(amount)) {
            throw new Error(`rule '${rule.label}' produced non-finite amount at t=${t}: ${amount}`);
          }
          next[rule.from] = (next[rule.from] ?? 0) - amount;
          next[rule.to] = (next[rule.to] ?? 0) + amount;
          deltas.push({ stock: rule.from, amount: -amount, rule: rule.label, ...(rule.loc && { loc: rule.loc }) });
          deltas.push({ stock: rule.to, amount, rule: rule.label, ...(rule.loc && { loc: rule.loc }) });
          return;
        }
      }
    };

    for (const rule of model.rules) {
      applyRule(rule, makeCtx());
    }

    stocks = next;
    history.push(freeze(t, stocks, deltas));
  }

  return Object.freeze(history);
}
