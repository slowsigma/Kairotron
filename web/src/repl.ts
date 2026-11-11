import type { DayCount, Horizon, Model, SourceLocation, TickUnit } from "../../src/core/types.js";
import { DEFAULT_DAY_COUNT, isDayCount, isTickUnit, retickHorizon } from "../../src/core/units.js";
import {
  between,
  date,
  derived,
  every,
  flow,
  lagged,
  laggedDelta,
  model,
  normal,
  once,
  pct,
  rate,
  stochastic,
  transfer,
  uniform,
  unless,
  when,
} from "../../src/dsl/model.js";

const DSL = {
  model, flow, transfer, rate, pct, when, unless, every, once, between,
  lagged, laggedDelta, derived, date, stochastic, normal, uniform,
};

// The REPL evaluates model code with new Function (Strudel's eval trick). V8
// wraps the body in a synthetic `function anonymous(...)` whose prologue shifts
// reported stack lines by an engine-dependent amount, so we calibrate at
// compile time: a probe error thrown on body line 3 tells us the shift, and
// user code starts at body line 5. Delta locations then map back to editor
// lines — the browser analog of Strudel's withLoc → highlight pipeline.
const PROBE =
  'var __K = 2; try { null.probe; } catch (e) { const m = String(e.stack).match(/(?:<anonymous>|eval code):?(\\d+)?/); if (m && m[1]) __K = Number(m[1]) - 3; }';

export interface Compiled {
  model: Model;
  lineOffset: number;
  lineCount: number;
}

export function compileModel(code: string): Compiled {
  const entries = Object.entries(DSL);
  let out: unknown;
  try {
    const fn = new Function(
      ...entries.map(([k]) => k),
      `\n\n${PROBE}\nreturn { spec: (\n${code}\n), offset: __K + 4 }`,
    );
    out = fn(...entries.map(([, v]) => v));
  } catch (e) {
    throw new Error(`model code failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { spec, offset } = out as { spec: unknown; offset: number };
  if (!spec || typeof spec !== "object" || !Array.isArray((spec as { rules?: unknown }).rules)) {
    throw new Error("model code must evaluate to model({ stocks, rules, ... })");
  }
  return { model: spec as Model, lineOffset: offset, lineCount: code.split("\n").length };
}

export function userLine(loc: SourceLocation | undefined, compiled: Pick<Compiled, "lineOffset" | "lineCount">): number | undefined {
  if (!loc?.line) return undefined;
  if (loc.file && !/anonymous|eval|<unknown>|VM\d+/.test(loc.file)) return undefined;
  const line = loc.line - compiled.lineOffset;
  return line >= 1 && line <= compiled.lineCount ? line : undefined;
}

// Horizon override from the UI. Changing the unit with start/end left on
// "auto" re-ticks the model's own horizon — duration-preserving, rates
// re-normalize. Explicit start/end are raw ticks in the chosen unit (opting
// out of duration preservation); the convention relabels the conversion.
export function horizonOverride(
  start: string,
  end: string,
  unit: string,
  convention: string,
  base: Horizon,
): Horizon | undefined {
  const sAuto = start.trim() === "";
  const eAuto = end.trim() === "";
  const s = sAuto ? base.start : Number(start);
  const e = eAuto ? base.end : Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new Error(`horizon start/end must be numbers`);
  if (unit !== "" && !isTickUnit(unit)) throw new Error(`unknown tick unit '${unit}'`);
  if (convention !== "" && !isDayCount(convention)) {
    throw new Error(`unknown day-count convention '${convention}'`);
  }
  const u = (unit === "" ? base.unit : unit) as TickUnit;
  const conv = convention === "" ? base.convention : (convention as DayCount);
  // The basis anchors tick 0, so it survives both paths: retickHorizon keeps
  // it, and raw explicit bounds still measure ticks from the same anchor.
  const horizon: Horizon =
    u !== base.unit && sAuto && eAuto
      ? retickHorizon({ ...base }, u, conv)
      : { start: s, end: e, unit: u, convention: conv, basis: base.basis };
  if (!(horizon.end > horizon.start)) {
    throw new Error(`horizon end (${horizon.end}) must exceed start (${horizon.start})`);
  }
  const unchanged =
    horizon.start === base.start &&
    horizon.end === base.end &&
    horizon.unit === base.unit &&
    (horizon.convention ?? DEFAULT_DAY_COUNT) === (base.convention ?? DEFAULT_DAY_COUNT) &&
    (horizon.basis ?? undefined) === (base.basis ?? undefined);
  return unchanged ? undefined : horizon;
}
