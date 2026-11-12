# Mini-notation reference

`mini()` and `miniDerived()` are Kairotron's sugar front end — the mini-
notation analog. They transpile a small line-oriented grammar into the **same
`Rule` / `DerivedDef` objects** the embedded DSL builds, so validation,
folding, and provenance are identical, and every delta points back at the
statement's own line (`mini(...)` call line + block line).

```ts run
import { mini, miniDerived, model, pct, run } from "kairotron";

const m = model({
  horizon: { start: 0, end: 12, unit: "month" },
  constants: { contribution: 2750, growth: pct(7, "year"), cashYield: pct(1.5, "year") },
  stocks: { preTax: 120000, cash: 25000 },
  rules: mini(`
    preTax += contribution       "monthly contribution"
    preTax += preTax * growth    "growth @ 7%/year"
    cash   += cash * cashYield   "interest @ 1.5%/year"
  `),
  derived: miniDerived(`
    ~netWorth = preTax + cash
    ~preTaxShare = preTax / netWorth
  `),
});

// the sugar folds tick-identical to the embedded-DSL retirement exemplar
const history = run(m);
if (Math.abs(history[1]!.stocks.preTax! - 123466.0416666) > 0.01) throw new Error("preTax drift");
if (Math.abs(history[1]!.derived.netWorth! - 148497.2916) > 0.01) throw new Error("netWorth drift");
```

## Statements

One statement per line; `;` separates several on one line; `#` starts a
comment. A statement is zero or more **prefixes**, then one **flow** or
**transfer**; derived blocks hold only `~name = expr` lines.

| Form | Meaning |
|---|---|
| `stock += expr "label"` | `flow(stock, +expr, label)` |
| `stock -= expr "label"` | `flow(stock, −expr, label)` |
| `stock -> other expr "label"` | `transfer(stock, other, expr, label)` (the `-> other:` colon form is also accepted) |
| `~name = expr` | `derived(name, expr)` — `miniDerived` blocks only |

The trailing label string is optional; without it the statement text itself
becomes the provenance label.

## Prefixes (nestable)

| Prefix | Desugars to |
|---|---|
| `when <guard>: <stmt>` | `when(guard, rule)` |
| `unless <guard>: <stmt>` | `unless(guard, rule)` |
| `every <n>: <stmt>` | `every(n, rule)` |
| `every <n> from <t>: <stmt>` | `every(n, rule, offset)` |
| `every <k>/<unit>: <stmt>` | rate interval, normalized to ticks |
| `once <t>: <stmt>` | `once(tick, rule)` |
| `between <a>..<b>: <stmt>` | `between(a, b, rule)` |

```
once 120: cash += 10k "retirement gift"
every 3/mo: preTax += 500/mo "quarterly top-up"
when t >= 240: pension += 2500 "pension starts"
when month == 12: cash -= 900 "annual premium"
```

Guards and schedules compose as nested prefixes:
`when age >= 73: every 12: cash += 900` reads exactly as it sounds.

## Expressions

- Arithmetic `+ - * /` with parentheses; unary `-`.
- `%` postfix: `2.5%` → `0.025`.
- `k` number suffix: `3k` → `3000` (`K` works too; `3kg` is an error).
- Scientific notation: `1e6`.
- Duration amounts — `expr / unit`: `3k/mo` means *3000 per month, normalized
  to the tick at fold time exactly like a rate* (plan.md's `spend 3k/mo`).
  A symbol the fold knows wins over the unit reading, so `a / day` with a
  stock named `day` divides. After `/`, a name that is a unit alias **and**
  not followed by `(` is the unit; `x / min(a, b)` is always a division.
- Functions: `lag(stock, n)`, `delta(stock, n)`, `min(a, b)`, `max(a, b)`,
  `abs(a)`. `lag`/`delta` read rule state and are unavailable inside
  `miniDerived` blocks.

Unit aliases after `/` and in `every` intervals: `s/sec/secs/second(s)`,
`min(s)`, `h/hr(s)/hour(s)`, `d/day(s)`, `w/wk(s)/week(s)`, `mo/month(s)`,
`q/quarter(s)`, `y/yr(s)/year(s)`.

### Name resolution

Names resolve at fold time, in order:

1. `t` — the built-in tick;
2. (in derived blocks) earlier `~` names;
3. plain constants;
4. stocks;
5. rate/stochastic constants — read per tick (so bare `growth` in an
   expression *is* `c.perTick("growth")`);
6. calendar date fields — `year`, `month`, `day`, `hours`, `minutes`,
   `seconds` (requires a horizon basis).

An unknown name is an error listing what it searched for.

## Guards

Comparisons `== != < <= > >=` over expressions, joined with `&&` / `||`,
negated with `!`, grouped with parentheses, plus the literals `true` /
`false`. A bare expression is truthy when non-zero. With a basis, date fields
make gates read like the plan's idiom:

```
when year >= 2048 && month == 12: cash -= 900 "December premium"
unless storage >= capacity: storage += inflow/1mo "inflow, below full"
```

A leading `(` is ambiguous (`(t > 2 || t < 1)` is a grouped guard,
`(a + b) > 2` is arithmetic); the parser prefers the grouping reading only
when a logical operator, `:`, `)`, or end-of-statement follows.

## Provenance

Each statement's location is computed from the `mini()` call site — file, the
call's line plus the block-relative line, and column — so `--flows` and the
browser highlight point at the *statement inside the block*, not at the
`mini()` call, even through nested prefixes. A statement's provenance text is
the statement without its label string. Pass `{ loc }` in `SugarOptions` to
override the call-site mapping (the browser REPL doesn't need to; it reads the
default).

## Errors

Sugar errors report the resolved line and a caret-free pointer in the message,
e.g.:

```text
mini: line 24: expected '+=', '-=', or '->' after 'preTax' (line 24)
mini: line 25: unexpected 'x' — one statement per line (line 25)
mini: line 26: unknown name 'growthh' (line 26) — not a constant, stock, rate, built-in t, or date field (...)
```

## Related

- [DSL reference](/reference/dsl) — what everything desugars into
- `examples/retirement-mini.ts` — the flagship retirement model in sugar,
  folded tick-identical to its embedded-DSL twin
