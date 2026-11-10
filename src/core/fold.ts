import type {
  Branch,
  ConstValue,
  DayCount,
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
import { DEFAULT_DAY_COUNT, daysPerTick, nearestWholeTick, normalizeRate, ticksPerInterval, wholeTicks } from "./units.js";

function isRate(v: ConstValue): v is Rate {
  return typeof v === "object" && v !== null && v.kind === "rate";
}

export function scheduleIntervalTicks(
  interval: number | Rate,
  tickUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): number {
  const ticks =
    typeof interval === "number"
      ? interval
      : ticksPerInterval(interval.value, interval.perUnit, tickUnit, convention);
  // Rate intervals convert through days, so a clean 1/minute on a second grid
  // can arrive as 60.00000000000001. Round the noise away before demanding a
  // whole positive count; a genuine fraction still fails.
  const rounded = nearestWholeTick(ticks);
  if (rounded === undefined || rounded <= 0) {
    const shown = typeof interval === "number" ? `${interval}` : `${interval.value}/${interval.perUnit}`;
    throw new Error(
      `schedule interval ${shown} does not land on a whole number of '${tickUnit}' ticks (${ticks}) under the '${convention}' day-count convention`,
    );
  }
  return rounded;
}

export function scheduleFires(
  spec: ScheduleSpec,
  t: number,
  tickUnit: TickUnit,
  convention: DayCount = DEFAULT_DAY_COUNT,
): boolean {
  switch (spec.kind) {
    case "every": {
      const n = scheduleIntervalTicks(spec.interval, tickUnit, convention);
      return t >= spec.offset && (t - spec.offset) % n === 0;
    }
    case "once":
      return t === spec.tick;
    case "between":
      return t >= spec.from && t <= spec.to;
  }
}

// Last snapshot with t <= the query (snapshots are ordered by tick). Reads
// before the first snapshot clamp to it, matching lag()'s leading-edge
// semantics; the scan is binary because cross-unit forks leave the shared
// prefix sparse — a tick-per-tick index only exists for same-unit histories.
export function snapAtOrBefore(history: readonly Snapshot[], t: number): Snapshot | undefined {
  if (history.length === 0) return undefined;
  if (t <= history[0]!.t) return history[0];
  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (history[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return history[lo];
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
  const branchUnit = horizon.unit;
  const crossUnit = branchUnit !== trunkUnit;
  if (!crossUnit) {
    if (atT < horizon.start) {
      throw new Error(`fork point t=${atT} is before the branch horizon start (${horizon.start})`);
    }
    if (atT >= horizon.end) {
      throw new Error(
        `fork point t=${atT} must be before the branch horizon end (${horizon.end}) — nothing left to run`,
      );
    }
  }
  const prefix = crossUnit
    ? remapPrefix(trunk.slice(0, idx + 1), horizon)
    : trunk.slice(0, idx + 1);
  if (crossUnit) {
    const forkT = prefix[prefix.length - 1]!.t;
    if (forkT >= horizon.end) {
      throw new Error(
        `fork point t=${atT} maps to ${forkT} '${branchUnit}' ticks, at or past the branch horizon end (${horizon.end}) — nothing left to run`,
      );
    }
  }
  const snapshots = fold(model, horizon, { prefix, stocks: spec.stocks });
  return Object.freeze({
    label: spec.label ?? "branch",
    forkT: atT,
    forkTBranch: prefix[prefix.length - 1]!.t,
    horizon,
    snapshots,
  });
}

// Tick re-normalization across a fork: the branch continues the trunk's
// history under a different tick unit, so the shared prefix is re-expressed
// by duration — tick numbers are durations from 0, and each trunk snapshot
// is placed at the branch tick with the same elapsed time. Snapshots whose
// duration doesn't land on a whole branch tick have no representable moment
// there and are dropped; lag() reads the surviving sparse prefix with
// hold-last semantics (snapAtOrBefore). The fork snapshot itself must land
// exactly — a what-if has to happen at a real branch tick.
function remapPrefix(prefix: readonly Snapshot[], horizon: Horizon): readonly Snapshot[] {
  const t0 = prefix[0]!.t;
  const trunkUnit = prefix[0]!.unit;
  const trunkConv = prefix[0]!.convention ?? DEFAULT_DAY_COUNT;
  const conv = horizon.convention ?? DEFAULT_DAY_COUNT;
  const branchUnit = horizon.unit;
  const ratio = daysPerTick(trunkUnit, trunkConv) / daysPerTick(branchUnit, conv);
  const out: Snapshot[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const s = prefix[i]!;
    const mapped = horizon.start + (s.t - t0) * ratio;
    const isFork = i === prefix.length - 1;
    let tick: number;
    try {
      tick = wholeTicks(mapped, `trunk snapshot t=${s.t}`, branchUnit, conv);
    } catch (e) {
      if (isFork) throw e;
      continue;
    }
    const remapped = Object.freeze({
      t: tick,
      unit: branchUnit,
      convention: conv,
      stocks: s.stocks,
      derived: s.derived,
      deltas: s.deltas,
    });
    // Two trunk moments rounding onto one branch tick (floating-point
    // adjacency at the epsilon boundary) keep the later snapshot: it holds
    // the newer state.
    if (out.length > 0 && out[out.length - 1]!.t === tick) out[out.length - 1] = remapped;
    else out.push(remapped);
  }
  return out;
}

interface FoldSeed {
  readonly prefix: readonly Snapshot[];
  readonly stocks?: Readonly<Record<string, number>> | undefined;
}

function fold(model: Model, horizon: Horizon, seed?: FoldSeed): readonly Snapshot[] {
  const { start, end } = horizon;
  const convention = horizon.convention ?? DEFAULT_DAY_COUNT;
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
    return normalizeRate(rate.value, rate.perUnit, horizon.unit, convention);
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
      convention,
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

  // Fold on from the last committed snapshot (S0 for plain runs, the fork
  // snapshot for seeded ones).
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
          // Hold-last read of the committed history: exact on dense
          // same-unit runs, and well-defined on the sparse prefix a
          // cross-unit fork shares (the value in force as of the queried
          // moment). Reads reaching back before the branch's first
          // snapshot clamp to it by design — S0 for plain runs, the
          // trunk's S0 for forks past the horizon start — pinned by the
          // "lags reaching before S0 clamp" test in test/gating.test.ts.
          const value = snapAtOrBefore(history, t - ticks)?.stocks[stock];
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
          if (scheduleFires(rule.schedule, t, horizon.unit, convention)) applyRule(rule.rule, ctx);
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
