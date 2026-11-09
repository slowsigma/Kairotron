import type {
  Branch,
  ConstValue,
  Delta,
  DerivedContext,
  ForkSpec,
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
  return fold(model, horizon);
}

// Branches & what-if: fork a fold at any committed snapshot. The branch
// shares the trunk's prefix snapshots by reference (states never mutate, so
// forking is free — Concept-Search.md), and lag() reads through the fork
// point into the shared trunk history.
export function fork(
  trunk: readonly Snapshot[],
  atT: number,
  model: Model,
  spec: ForkSpec = {},
): Branch {
  if (trunk.length === 0) throw new Error("fork() requires a non-empty history to fork from");
  if (!Number.isInteger(atT)) throw new Error(`fork point must be an integer tick (got ${atT})`);
  const idx = trunk.findIndex((s) => s.t === atT);
  if (idx === -1) {
    throw new Error(
      `fork point t=${atT} is not in the history (${trunk[0]!.t}..${trunk[trunk.length - 1]!.t})`,
    );
  }
  const horizon = spec.horizon ?? model.horizon;
  if (!horizon) throw new Error("forked model has no horizon and none was passed in the fork spec");
  const trunkUnit = trunk[0]!.unit;
  if (horizon.unit !== trunkUnit) {
    throw new Error(
      `can't change the tick unit across a fork yet (trunk is '${trunkUnit}', branch is '${horizon.unit}'; that's milestone 6)`,
    );
  }
  if (atT < horizon.start) {
    throw new Error(`fork point t=${atT} is before the branch horizon start (${horizon.start})`);
  }
  if (atT >= horizon.end) {
    throw new Error(
      `fork point t=${atT} must be before the branch horizon end (${horizon.end}) — nothing left to run`,
    );
  }
  const snapshots = fold(model, horizon, { prefix: trunk.slice(0, idx + 1), stocks: spec.stocks });
  return Object.freeze({ label: spec.label ?? "branch", forkT: atT, horizon, snapshots });
}

interface FoldSeed {
  readonly prefix: readonly Snapshot[];
  readonly stocks?: Readonly<Record<string, number>> | undefined;
}

function fold(model: Model, horizon: Horizon, seed?: FoldSeed): readonly Snapshot[] {
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

  // Seeded folds take the state from the fork snapshot; a variant model may
  // still introduce new stocks, which enter at their declared initial value.
  let stocks: Record<string, number> = seed
    ? { ...model.stocks, ...seed.prefix[seed.prefix.length - 1]!.stocks }
    : { ...model.stocks };
  const history: Snapshot[] = seed ? [...seed.prefix] : [];

  const perTickFn = (name: string): number => {
    const rate = rateConstants[name];
    if (!rate) throw new Error(`no rate constant named '${name}'`);
    return normalizeRate(rate.value, rate.perUnit, horizon.unit);
  };

  // Read-only projections (plan.md): pure in (stocks, constants, t) plus
  // earlier derivations — later/unknown references throw, which is what
  // keeps the derivation graph acyclic by construction.
  const evaluateDerived = (t: number, values: StockMap): StockMap => {
    const out: Record<string, number> = {};
    for (const def of model.derived) {
      const visible: StockMap = new Proxy(out, {
        get(target, key) {
          // `key in target` walks Object.prototype, so reads like
          // c.derived.toString / .hasOwnProperty would silently resolve to
          // inherited junk instead of throwing as unknown.
          if (typeof key === "string" && !Object.hasOwn(target, key)) {
            const seen = Object.keys(out);
            const prior = seen.length ? `already defined: ${seen.join(", ")}` : "none defined before it";
            throw new Error(
              `derived '${def.name}' reads unknown or forward-referenced derived '${key}' ` +
                `(derivations must be acyclic; ${prior})`,
            );
          }
          return target[key as string];
        },
      });
      const ctx: DerivedContext = Object.freeze({
        t,
        stocks: Object.freeze({ ...values }),
        derived: visible,
        constants: Object.freeze({ ...plainConstants }),
        horizon,
        tickUnit: horizon.unit,
        perTick: perTickFn,
      });
      const value = def.expr(ctx);
      if (!Number.isFinite(value)) {
        throw new Error(`derived '${def.name}' produced non-finite value at t=${t}: ${value}`);
      }
      out[def.name] = value;
    }
    return out;
  };

  const freeze = (
    t: number,
    values: StockMap,
    deltas: readonly Delta[],
    derivedFallback?: StockMap,
  ): Snapshot => {
    let derived: StockMap;
    if (derivedFallback) {
      // An override rewrites the shared fork snapshot. A variant derivation may
      // read a stock that only enters on the next tick, so fall back to the
      // prefix's projections rather than failing on a value that isn't visible
      // at this tick yet.
      try {
        derived = evaluateDerived(t, values);
      } catch {
        derived = derivedFallback;
      }
    } else {
      derived = evaluateDerived(t, values);
    }
    return Object.freeze({
      t,
      unit: horizon.unit,
      stocks: Object.freeze({ ...values }),
      derived: Object.freeze({ ...derived }),
      deltas: Object.freeze(deltas.map((d) => Object.freeze({ ...d }))),
    });
  };

  if (seed) {
    const head = history[history.length - 1]!;
    if (seed.stocks && Object.keys(seed.stocks).length > 0) {
      for (const [name, value] of Object.entries(seed.stocks)) {
        if (!Number.isFinite(value)) {
          throw new Error(`fork override '${name}' must be finite (got ${value})`);
        }
      }
      // The fork snapshot carries the shared prefix state plus explicit
      // overrides only; stocks the variant merely declares enter on the
      // branch's first folded tick, not retroactively at the fork point.
      const forkStocks = { ...head.stocks, ...seed.stocks };
      stocks = { ...stocks, ...seed.stocks };
      const deltas: Delta[] = Object.entries(seed.stocks).map(([stock, amount]) => ({
        stock,
        amount: amount - (head.stocks[stock] ?? 0),
        rule: `fork @t=${head.t}`,
      }));
      history[history.length - 1] = freeze(head.t, forkStocks, deltas, head.derived);
    }
  } else {
    history.push(freeze(start, stocks, []));
  }

  // Absolute-tick anchor for lag lookups: index 0 of the branch's history is
  // the trunk's S0 for forks, the model's own S0 otherwise.
  const t0 = history[0]!.t;
  const from = history[history.length - 1]!.t;

  for (let t = from + 1; t <= end; t++) {
    const next: Record<string, number> = { ...stocks };
    const deltas: Delta[] = [];

    const makeCtx = (): TickContext =>
      Object.freeze({
        t,
        stocks: Object.freeze({ ...next }),
        constants: Object.freeze({ ...plainConstants }),
        horizon,
        tickUnit: horizon.unit,
        perTick: perTickFn,
        lag(stock: string, ticks: number): number {
          if (!Number.isInteger(ticks) || ticks < 1) {
            throw new Error(`lag requires a whole number of ticks >= 1 (got ${ticks})`);
          }
          // With input validation done, the lookup can only land inside the
          // committed history except at the leading edge: a lag reaching back
          // before the branch's first snapshot has nothing to read, so it
          // clamps to that snapshot by design — S0 for plain runs, the trunk's
          // S0 for forks past the horizon start. Lags across a fork point
          // read the shared prefix. That dichotomy is pinned by the
          // "lags reaching before S0 clamp" test in test/gating.test.ts.
          const committed = history.length - 1;
          const index = Math.max(t - ticks - t0, 0);
          const clamped = Math.min(index, committed);
          const value = history[clamped]?.stocks[stock];
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
