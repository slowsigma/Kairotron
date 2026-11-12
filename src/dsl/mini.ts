import type {
  CalendarDate,
  DayCount,
  DerivedDef,
  Horizon,
  Rate,
  Rule,
  SourceLocation,
  StockMap,
  TickContext,
  TickUnit,
} from "../core/types.js";
import { DEFAULT_DAY_COUNT, normalizeRate } from "../core/units.js";
import { between, captureLoc, derived, every, flow, once, transfer, unless, when } from "./model.js";

// The sugar front end: plan.md's "small PEG-grammar sugar parser (the
// mini-notation analog)". Line-oriented statements transpile to the same
// Rule / DerivedDef objects flow()/when()/... build, so validation, folding,
// and provenance are identical — and every emitted loc points back at the
// host source (mini() call line + block line), which is what keeps the
// playhead highlighting honest through the sugar.
//
// Grammar (one statement per line; ';' separates several; '#' comments):
//
//   rule      := prefix* (flow | transfer)
//   prefix    := 'when' guard ':' | 'unless' guard ':'
//              | 'every' interval ['from' INT] ':' | 'once' INT ':'
//              | 'between' INT '..' INT ':'
//   flow      := NAME ('+=' | '-=') expr [STRING]
//   transfer  := NAME '->' NAME ':'? expr [STRING]
//   derived   := '~' NAME '=' expr                  (miniDerived blocks)
//   interval  := INT | NUM '/' UNIT
//   guard     := comparisons / '&&' / '||' / '!' / 'true' / 'false' over exprs
//   expr      := + - * / parens, '%' postfix (÷100), 'k' number suffix (×1000),
//              | lag(stock, n) / delta(stock, n), min(a, b) / max(a, b) /
//              | abs(a), and duration amounts '3k/mo' — an amount per
//              | calendar unit normalized to the tick at fold time exactly
//              | like a rate (the plan's `spend 3k/mo`)
//
// Names resolve at fold time against the running context, in order: the
// built-in tick `t`, constants, stocks, rate/stochastic constants (read per
// tick), then calendar date fields (year, month, day, hours, minutes,
// seconds — needs a horizon basis). miniDerived() blocks additionally see
// earlier `~` names (acyclic, as always). Unit words are reserved after '/'
// (write `x / 12` for plain division).

interface NumCtx {
  readonly t: number;
  readonly stocks: StockMap;
  readonly constants: Readonly<Record<string, number>>;
  readonly horizon: Horizon;
  readonly tickUnit: TickUnit;
  readonly derived?: StockMap | undefined;
  perTick(name: string): number;
  date(t?: number): CalendarDate;
}

type Fx = (c: NumCtx) => number;
type Gd = (c: NumCtx) => boolean;

interface Tok {
  readonly kind: "num" | "str" | "name" | "punc";
  readonly value: string;
  readonly num: number;
  readonly col: number;
}

const PUNCTS = [
  "+=", "-=", "->", "..", ">=", "<=", "==", "!=", "&&", "||",
  "(", ")", ":", "=", "+", "-", "*", "/", "<", ">", "!", "~", "%", ";", ",",
];

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

// Shorthand unit spellings, recognized after '/' (duration amounts) and in
// the 'every' interval.
const UNIT_ALIASES: Readonly<Record<string, TickUnit>> = {
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  d: "day", day: "day", days: "day",
  w: "week", wk: "week", wks: "week", week: "week", weeks: "week",
  mo: "month", month: "month", months: "month",
  q: "quarter", quarter: "quarter", quarters: "quarter",
  y: "year", yr: "year", yrs: "year", year: "year", years: "year",
};

const DATE_FIELDS: Readonly<Record<string, (d: CalendarDate) => number>> = {
  year: (d) => d.year,
  month: (d) => d.month,
  day: (d) => d.day,
  hours: (d) => d.hours,
  minutes: (d) => d.minutes,
  seconds: (d) => d.seconds,
};

class SugarError extends Error {}

function fail(message: string): never {
  throw new SugarError(message);
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "#") break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") {
          value += text[j + 1] ?? "";
          j += 2;
        } else {
          value += text[j]!;
          j++;
        }
      }
      if (j >= text.length) fail(`unterminated string at column ${i + 1}`);
      toks.push({ kind: "str", value, num: NaN, col: i + 1 });
      i = j + 1;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      let end = num[0]!.length;
      let value = Number(num[0]!);
      if (text[i + end] === "k" || text[i + end] === "K") {
        const after = text[i + end + 1];
        if (after !== undefined && NAME_CHAR.test(after)) fail(`invalid number '${text.slice(i, i + end + 1)}...'`);
        value *= 1000;
        end++;
      }
      toks.push({ kind: "num", value: num[0]!, num: value, col: i + 1 });
      i += end;
      continue;
    }
    if (NAME_START.test(ch)) {
      let j = i;
      while (j < text.length && NAME_CHAR.test(text[j]!)) j++;
      toks.push({ kind: "name", value: text.slice(i, j), num: NaN, col: i + 1 });
      i = j;
      continue;
    }
    const punc = PUNCTS.find((p) => text.startsWith(p, i));
    if (punc) {
      toks.push({ kind: "punc", value: punc, num: NaN, col: i + 1 });
      i += punc.length;
      continue;
    }
    fail(`unexpected character '${ch}' at column ${i + 1}`);
  }
  return toks;
}

// ';' separates statements. Labels are string tokens, so a ';' can never be
// hiding inside a quoted label at this level.
function splitStatements(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let current: Tok[] = [];
  for (const tok of toks) {
    if (tok.kind === "punc" && tok.value === ";") {
      if (current.length > 0) out.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

interface ParseCtx {
  readonly mode: "rule" | "derived";
  readonly where: string;
  readonly derivedNames: ReadonlySet<string>;
  pos: number;
  labelCol: number | undefined;
}

function locAt(base: SourceLocation, relLine: number, tok: Tok): SourceLocation {
  const line = base.line === undefined ? relLine + 1 : base.line + relLine;
  const column = base.column === undefined || relLine > 0 ? tok.col : base.column + tok.col - 1;
  return {
    ...(base.file === undefined ? {} : { file: base.file }),
    line,
    column,
  };
}

class Cursor {
  constructor(
    readonly toks: readonly Tok[],
    readonly ctx: ParseCtx,
  ) {}

  peek(): Tok | undefined {
    return this.toks[this.ctx.pos];
  }

  next(): Tok {
    const tok = this.peek();
    if (!tok) fail(`unexpected end of statement (${this.ctx.where})`);
    this.ctx.pos++;
    return tok;
  }

  isName(value: string): boolean {
    const tok = this.peek();
    return tok?.kind === "name" && tok.value === value;
  }

  isPunc(value: string): boolean {
    const tok = this.peek();
    return tok?.kind === "punc" && tok.value === value;
  }

  expectName(what: string): Tok {
    const tok = this.next();
    if (tok.kind !== "name") fail(`expected ${what}, got '${tok.value}' (${this.ctx.where})`);
    return tok;
  }

  expectPunc(value: string): Tok {
    const tok = this.next();
    if (tok.kind !== "punc" || tok.value !== value) {
      fail(`expected '${value}', got '${tok.value}' (${this.ctx.where})`);
    }
    return tok;
  }

  expectNum(what: string): Tok {
    const tok = this.next();
    if (tok.kind !== "num") fail(`expected ${what}, got '${tok.value}' (${this.ctx.where})`);
    return tok;
  }

  intLit(what: string): number {
    let sign = 1;
    if (this.isPunc("-")) {
      this.next();
      sign = -1;
    }
    const tok = this.expectNum(what);
    if (!Number.isInteger(tok.num)) fail(`expected ${what} (a whole number), got ${tok.num} (${this.ctx.where})`);
    return sign * tok.num;
  }

  end(): void {
    if (this.ctx.pos < this.toks.length) {
      const tok = this.toks[this.ctx.pos]!;
      fail(`unexpected '${tok.value}' — one statement per line (${this.ctx.where})`);
    }
  }
}

function readName(
  c: NumCtx,
  name: string,
  mode: "rule" | "derived",
  derivedNames: ReadonlySet<string>,
  where: string,
): number {
  if (name === "t") return c.t;
  if (mode === "derived" && derivedNames.has(name)) {
    // Read through the fold's derived view: the engine's own proxy enforces
    // the acyclic rule (unknown or forward references throw there).
    return c.derived![name]!;
  }
  if (Object.hasOwn(c.constants, name)) return c.constants[name]!;
  if (Object.hasOwn(c.stocks, name)) return c.stocks[name]!;
  try {
    return c.perTick(name);
  } catch {
    // not a rate/stochastic constant — fall through to the date fields
  }
  const field = DATE_FIELDS[name];
  if (field) return field(c.date());
  fail(
    `mini: unknown name '${name}' (${where}) — not a constant, stock, rate, built-in t, ` +
      `or date field (${Object.keys(DATE_FIELDS).join(", ")}); lag()/delta() read stocks`,
  );
}

function parseAtom(cur: Cursor): Fx {
  const tok = cur.peek();
  if (!tok) fail(`unexpected end of expression (${cur.ctx.where})`);
  if (tok.kind === "num") {
    cur.next();
    return () => tok.num;
  }
  if (tok.kind === "punc" && tok.value === "(") {
    cur.next();
    const inner = parseExpr(cur);
    cur.expectPunc(")");
    return inner;
  }
  if (tok.kind === "name") {
    const after = cur.toks[cur.ctx.pos + 1];
    if (after && after.kind === "punc" && after.value === "(") {
      cur.next();
      cur.next();
      const fn = tok.value;
      if (fn === "lag" || fn === "delta") {
        if (cur.ctx.mode === "derived") {
          fail(`lag()/delta() read rule state and are not available in ${cur.ctx.where}`);
        }
        const stock = cur.expectName("a stock name").value;
        cur.expectPunc(",");
        const ticks = parseExpr(cur);
        cur.expectPunc(")");
        if (fn === "lag") return (c) => (c as TickContext).lag(stock, ticks(c));
        return (c) => {
          const tctx = c as TickContext;
          const n = ticks(c);
          return tctx.lag(stock, n) - tctx.lag(stock, n + 1);
        };
      }
      const arity = fn === "min" || fn === "max" ? 2 : fn === "abs" ? 1 : 0;
      if (arity === 0) {
        fail(`unknown function '${fn}()' (${cur.ctx.where}) — available: lag(stock, n), delta(stock, n), min(a, b), max(a, b), abs(a)`);
      }
      const args: Fx[] = [];
      if (!cur.isPunc(")")) {
        for (;;) {
          args.push(parseExpr(cur));
          if (!cur.isPunc(",")) break;
          cur.next();
        }
      }
      cur.expectPunc(")");
      if (args.length !== arity) {
        fail(`${fn}() takes ${arity} argument(s), got ${args.length} (${cur.ctx.where})`);
      }
      const [a, b] = args as [Fx, Fx?];
      if (fn === "min") return (c) => Math.min(a(c), (b as Fx)(c));
      if (fn === "max") return (c) => Math.max(a(c), (b as Fx)(c));
      return (c) => Math.abs(a(c));
    }
    cur.next();
    const name = tok.value;
    const { mode, where, derivedNames } = cur.ctx;
    return (c) => readName(c, name, mode, derivedNames, where);
  }
  fail(`unexpected '${tok.value}' in an expression (${cur.ctx.where})`);
}

function parsePostfix(cur: Cursor): Fx {
  let fx = parseAtom(cur);
  while (cur.isPunc("%")) {
    cur.next();
    const inner = fx;
    fx = (c) => inner(c) / 100;
  }
  return fx;
}

function parseUnary(cur: Cursor): Fx {
  if (cur.isPunc("-")) {
    cur.next();
    const inner = parseUnary(cur);
    return (c) => -inner(c);
  }
  if (cur.isPunc("+")) {
    cur.next();
    return parseUnary(cur);
  }
  return parsePostfix(cur);
}

function amountPer(c: NumCtx, amount: Fx, perUnit: TickUnit): number {
  const convention: DayCount = c.horizon.convention ?? DEFAULT_DAY_COUNT;
  return normalizeRate(amount(c), perUnit, c.tickUnit, convention);
}

function parseMul(cur: Cursor): Fx {
  let left = parseUnary(cur);
  for (;;) {
    if (cur.isPunc("*")) {
      cur.next();
      const right = parseUnary(cur);
      const l = left;
      left = (c) => l(c) * right(c);
      continue;
    }
    if (cur.isPunc("/")) {
      const next = cur.toks[cur.ctx.pos + 1];
      const unit = next && next.kind === "name" ? UNIT_ALIASES[next.value] : undefined;
      if (unit) {
        // A duration amount: `3k/mo` is 3000 per month, normalized to the
        // tick at fold time like any rate (units are semantics).
        cur.next();
        cur.next();
        const l = left;
        left = (c) => amountPer(c, l, unit);
        continue;
      }
      cur.next();
      const right = parseUnary(cur);
      const l = left;
      left = (c) => l(c) / right(c);
      continue;
    }
    return left;
  }
}

function parseAdd(cur: Cursor): Fx {
  let left = parseMul(cur);
  for (;;) {
    if (cur.isPunc("+")) {
      cur.next();
      const right = parseMul(cur);
      const l = left;
      left = (c) => l(c) + right(c);
      continue;
    }
    if (cur.isPunc("-")) {
      cur.next();
      const right = parseMul(cur);
      const l = left;
      left = (c) => l(c) - right(c);
      continue;
    }
    return left;
  }
}

function parseExpr(cur: Cursor): Fx {
  return parseAdd(cur);
}

const COMPARISONS: Readonly<Record<string, (a: number, b: number) => boolean>> = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

function parseGuard(cur: Cursor): Gd {
  let left = parseGuardAnd(cur);
  while (cur.isPunc("||")) {
    cur.next();
    const right = parseGuardAnd(cur);
    const l = left;
    left = (c) => l(c) || right(c);
  }
  return left;
}

function parseGuardAnd(cur: Cursor): Gd {
  let left = parseComparison(cur);
  while (cur.isPunc("&&")) {
    cur.next();
    const right = parseComparison(cur);
    const l = left;
    left = (c) => l(c) && right(c);
  }
  return left;
}

function parseComparison(cur: Cursor): Gd {
  if (cur.isPunc("!")) {
    cur.next();
    const inner = parseComparison(cur);
    return (c) => !inner(c);
  }
  if (cur.isPunc("(")) {
    cur.next();
    const inner = parseGuard(cur);
    cur.expectPunc(")");
    return inner;
  }
  const head = cur.peek();
  if (head?.kind === "name" && (head.value === "true" || head.value === "false")) {
    const value = head.value === "true";
    cur.next();
    return () => value;
  }
  const left = parseExpr(cur);
  const op = cur.peek();
  if (op?.kind === "punc" && op.value in COMPARISONS) {
    cur.next();
    const right = parseExpr(cur);
    const cmp = COMPARISONS[op.value]!;
    return (c) => cmp(left(c), right(c));
  }
  return (c) => left(c) !== 0;
}

function parseInterval(cur: Cursor): number | Rate {
  const tok = cur.expectNum("a schedule interval");
  if (cur.isPunc("/")) {
    cur.next();
    const unitTok = cur.expectName("a unit after '/'");
    const unit = UNIT_ALIASES[unitTok.value];
    if (!unit) {
      fail(
        `unknown unit '${unitTok.value}' (${cur.ctx.where}) — expected one of: ` +
          `s, min, h, d, w, mo, q, y or their full names`,
      );
    }
    return { kind: "rate", value: tok.num, perUnit: unit };
  }
  return tok.num;
}

function parseLabel(cur: Cursor): { label: string; col: number } | undefined {
  const tok = cur.peek();
  if (tok?.kind !== "str") {
    cur.end();
    return undefined;
  }
  cur.next();
  cur.end();
  cur.ctx.labelCol = tok.col;
  return { label: tok.value, col: tok.col };
}

function parseRuleStatement(cur: Cursor, text: string, base: SourceLocation, relLine: number): Rule {
  const headLoc = { ...locAt(base, relLine, cur.toks[cur.ctx.pos] ?? cur.toks[0]!), text };
  if (cur.isName("when") || cur.isName("unless")) {
    const keyword = cur.next().value;
    const guard = parseGuard(cur);
    cur.expectPunc(":");
    const inner = parseRuleStatement(cur, text, base, relLine);
    return keyword === "when" ? when(guard, inner, headLoc) : unless(guard, inner, headLoc);
  }
  if (cur.isName("every")) {
    cur.next();
    const interval = parseInterval(cur);
    let offset = 0;
    if (cur.isName("from")) {
      cur.next();
      offset = cur.intLit("an offset tick");
      if (offset < 0) fail(`every offset must not be negative (${cur.ctx.where})`);
    }
    cur.expectPunc(":");
    return every(interval, parseRuleStatement(cur, text, base, relLine), offset, headLoc);
  }
  if (cur.isName("once")) {
    cur.next();
    const tick = cur.intLit("a tick");
    cur.expectPunc(":");
    return once(tick, parseRuleStatement(cur, text, base, relLine), headLoc);
  }
  if (cur.isName("between")) {
    cur.next();
    const from = cur.intLit("a from tick");
    cur.expectPunc("..");
    const to = cur.intLit("a to tick");
    cur.expectPunc(":");
    return between(from, to, parseRuleStatement(cur, text, base, relLine), headLoc);
  }
  const stock = cur.expectName("a stock name").value;
  if (cur.isPunc("+=") || cur.isPunc("-=")) {
    const sign = cur.next().value === "-=" ? -1 : 1;
    const fx = parseExpr(cur);
    const label = parseLabel(cur);
    const amount: Fx = sign === 1 ? fx : (c) => -fx(c);
    return flow(stock, (c) => amount(c), label?.label ?? text, headLoc);
  }
  if (cur.isPunc("->")) {
    cur.next();
    const target = cur.expectName("a stock name").value;
    if (cur.isPunc(":")) cur.next();
    const fx = parseExpr(cur);
    const label = parseLabel(cur);
    return transfer(stock, target, (c) => fx(c), label?.label ?? text, headLoc);
  }
  fail(`expected '+=', '-=', or '->' after '${stock}' (${cur.ctx.where})`);
}

function parseDerivedStatement(cur: Cursor, text: string, base: SourceLocation, relLine: number): DerivedDef {
  cur.expectPunc("~");
  const name = cur.expectName("a derived name").value;
  cur.expectPunc("=");
  const fx = parseExpr(cur);
  if (cur.peek()?.kind === "str") fail(`derived values take no label (${cur.ctx.where})`);
  cur.end();
  const loc = { ...locAt(base, relLine, cur.toks[0]!), text };
  return derived(name, (c) => fx(c), loc);
}

function withText<T extends Rule | DerivedDef>(node: T, text: string): T {
  return node.loc ? { ...node, loc: { ...node.loc, text } } : node;
}

function parseProgram(source: string, mode: "rule" | "derived", base: SourceLocation): (Rule | DerivedDef)[] {
  const out: (Rule | DerivedDef)[] = [];
  const lines = source.split("\n");
  // Pre-scan the declared `~` names so a derived expression reading one of
  // them goes through the fold's acyclic derived view (which reports forward
  // references) instead of the unknown-name path.
  const derivedNames = new Set<string>();
  if (mode === "derived") {
    for (const text of lines) {
      let ts: Tok[];
      try {
        ts = tokenize(text);
      } catch {
        continue;
      }
      for (const seg of splitStatements(ts)) {
        const head = seg[0];
        if (head && head.kind === "punc" && head.value === "~" && seg[1]?.kind === "name") {
          derivedNames.add(seg[1]!.value);
        }
      }
    }
  }
  for (let rel = 0; rel < lines.length; rel++) {
    const text = lines[rel]!;
    const lineLabel = base.line === undefined ? `line ${rel + 1} of the mini block` : `line ${base.line + rel}`;
    let toks: Tok[];
    try {
      toks = tokenize(text);
    } catch (e) {
      if (e instanceof SugarError) throw new Error(`mini: ${lineLabel}: ${e.message}`);
      throw e;
    }
    if (toks.length === 0) continue;
    for (const seg of splitStatements(toks)) {
      const first = seg[0]!;
      const last = seg[seg.length - 1]!;
      const raw = text.slice(
        first.col - 1,
        last.col - 1 + last.value.length + (last.kind === "str" ? 2 : 0),
      );
      const ctx: ParseCtx = { mode, where: lineLabel, derivedNames, pos: 0, labelCol: undefined };
      const cur = new Cursor(seg, ctx);
      const isDerived = first.kind === "punc" && first.value === "~";
      if (mode === "rule" && isDerived) {
        throw new Error(`mini: ${lineLabel}: '~name = expr' declares a derived value — put it in a miniDerived() block`);
      }
      if (mode === "derived" && !isDerived) {
        throw new Error(`mini: ${lineLabel}: miniDerived() statements look like '~name = expr' (got '${first.value}')`);
      }
      let node: Rule | DerivedDef;
      try {
        node = isDerived
          ? parseDerivedStatement(cur, raw, base, rel)
          : parseRuleStatement(cur, raw, base, rel);
      } catch (e) {
        if (e instanceof SugarError) throw new Error(`mini: ${lineLabel}: ${e.message}`);
        throw e;
      }
      if (ctx.labelCol !== undefined && node.loc?.text) {
        // The provenance text shows the statement without its label string.
        node = withText(node, text.slice(first.col - 1, ctx.labelCol - 1).trimEnd() || node.loc.text);
      }
      out.push(node);
    }
  }
  return out;
}

export interface SugarOptions {
  // Host location the block transpiles against; by default the caller's stack
  // frame is read, so locs point at the mini()/miniDerived() call site (and
  // the browser REPL maps them to editor lines like every other rule).
  readonly loc?: SourceLocation;
}

export function mini(source: string, options: SugarOptions = {}): Rule[] {
  return parseProgram(source, "rule", options.loc ?? captureLoc(1) ?? {}) as Rule[];
}

export function miniDerived(source: string, options: SugarOptions = {}): DerivedDef[] {
  return parseProgram(source, "derived", options.loc ?? captureLoc(1) ?? {}) as DerivedDef[];
}
