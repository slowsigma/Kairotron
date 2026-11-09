import type { Horizon, Model, SourceLocation, TickUnit } from "../../src/core/types.js";
import {
  between,
  derived,
  every,
  flow,
  lagged,
  laggedDelta,
  model,
  once,
  pct,
  rate,
  transfer,
  unless,
  when,
} from "../../src/dsl/model.js";

const DSL = { model, flow, transfer, rate, pct, when, unless, every, once, between, lagged, laggedDelta, derived };

// The REPL evaluates model code with new Function (Strudel's eval trick). V8
// wraps the body in a synthetic `function anonymous(...)` whose prologue shifts
// reported stack lines by an engine-dependent amount, so we calibrate at
// compile time: a probe error thrown on body line 3 tells us the shift, and
// user code starts at body line 5. Delta locations then map back to editor
// lines — the browser analog of Strudel's withLoc → highlight pipeline.
const PROBE =
  'var __K = 2; try { null.probe; } catch (e) { const m = String(e.stack).match(/<anonymous>:(\\d+)/); if (m) __K = Number(m[1]) - 3; }';

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
  if (loc.file && !/anonymous|eval/.test(loc.file)) return undefined;
  const line = loc.line - compiled.lineOffset;
  return line >= 1 && line <= compiled.lineCount ? line : undefined;
}

export function horizonOverride(start: string, end: string, unit: string, base: Horizon): Horizon | undefined {
  const s = start.trim() === "" ? base.start : Number(start);
  const e = end.trim() === "" ? base.end : Number(end);
  const u = unit === "" ? base.unit : (unit as TickUnit);
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new Error(`horizon start/end must be numbers`);
  if (!(e > s)) throw new Error(`horizon end (${e}) must exceed start (${s})`);
  return s === base.start && e === base.end && u === base.unit ? undefined : { start: s, end: e, unit: u };
}
