import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { date, model, pct } from "../src/dsl/model.js";
import { mini, miniDerived } from "../src/dsl/mini.js";
import retirement from "../examples/retirement.js";
import retirementMini from "../examples/retirement-mini.js";

const ticksWith = (m: ReturnType<typeof model>, label: string): number[] =>
  run(m)
    .filter((s) => s.deltas.some((d) => d.rule === label))
    .map((s) => s.t);

const miniModel = (
  src: string,
  spec: Omit<Parameters<typeof model>[0], "rules" | "stocks"> & { stocks: Record<string, number> } = {
    stocks: { a: 0 },
    horizon: { start: 0, end: 12, unit: "month" },
  },
) => model({ ...spec, rules: mini(src) });

describe("mini: transpiled rules match the builder", () => {
  it("the retirement-mini example folds identically to retirement.ts", () => {
    const trunk = run(retirement);
    const sugar = run(retirementMini);
    expect(sugar).toHaveLength(trunk.length);
    for (let t = 0; t < trunk.length; t++) {
      expect(sugar[t]!.stocks).toEqual(trunk[t]!.stocks);
      expect(sugar[t]!.derived).toEqual(trunk[t]!.derived);
      expect(sugar[t]!.deltas.map((d) => [d.stock, d.amount, d.rule])).toEqual(
        trunk[t]!.deltas.map((d) => [d.stock, d.amount, d.rule]),
      );
    }
  });

  it("names resolve against constants, rate constants, stocks, and t", () => {
    const m = model({
      horizon: { start: 0, end: 4, unit: "month" },
      constants: { fee: 5, growth: pct(12, "year") },
      stocks: { pot: 1000, age: 0 },
      rules: mini(`
        pot += fee            "fee"
        pot += pot * growth   "growth"
        age += t              "age"
      `),
    });
    const history = run(m);
    // same-tick composition: the fee lands before the growth rule reads pot
    expect(history[1]!.stocks.pot).toBeCloseTo(1000 + 5 + 1005 * 0.01, 8);
    expect(history[1]!.stocks.age).toBe(1);
    expect(history[4]!.stocks.age).toBe(1 + 2 + 3 + 4);
  });
});

describe("mini: expressions", () => {
  it("k magnitudes, percent postfix, and scientific notation", () => {
    const m = miniModel(`
      a += 3k          "k"
      a += 2.5%        "pct"
      a += 1e3         "sci"
      a += -500        "neg"
    `);
    expect(run(m)[1]!.stocks.a).toBe(3000 + 0.025 + 1000 - 500);
  });

  it("arithmetic with precedence and parens", () => {
    const m = miniModel(`a += (1 + 2) * 3 - 4 / 2`);
    expect(run(m)[1]!.stocks.a).toBe(7);
  });

  it("min/max/abs clamp amounts", () => {
    const m = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { tank: 50, spill: 0 },
      rules: mini(`
        tank  += 25                       "rain"
        tank  -> spill: max(tank - 50, 0) "weir overflow"
      `),
    });
    const history = run(m);
    expect(history[1]!.stocks).toEqual({ tank: 50, spill: 25 });
    expect(history[3]!.stocks).toEqual({ tank: 50, spill: 75 });
  });

  it("a duration amount normalizes to the tick like a rate (3k/mo on daily ticks)", () => {
    const m = model({
      horizon: { start: 0, end: 30, unit: "day" },
      stocks: { cash: 10000 },
      rules: mini(`cash -= 3k/mo "spend 3k/mo"`),
    });
    const perTick = 3000 / (364 / 12);
    expect(run(m)[1]!.stocks.cash).toBeCloseTo(10000 - perTick, 8);
    expect(run(m)[30]!.stocks.cash).toBeCloseTo(10000 - 30 * perTick, 6);
  });

  it("a duration amount honors the day-count convention", () => {
    const m = model({
      horizon: { start: 0, end: 30, unit: "day", convention: "30/360" },
      stocks: { cash: 10000 },
      rules: mini(`cash -= 3k/mo "spend 3k/mo"`),
    });
    expect(run(m)[30]!.stocks.cash).toBe(10000 - 30 * 100);
  });

  it("lag/delta read committed history (the supply-chain delay in sugar)", () => {
    const m = model({
      horizon: { start: 0, end: 8, unit: "month" },
      stocks: { a: 0, b: 0 },
      rules: mini(`
        a += 10                 "fill"
        b += lag(a, 1)          "echo"
        b += delta(a, 2)        "delayed echo"
      `),
    });
    const history = run(m);
    expect(history[2]!.stocks.b).toBe(10);
    expect(history[3]!.stocks.b).toBe(30 + 10);
  });
});

describe("mini: schedules and guards", () => {
  it("every(n), every(n) from k, and rate intervals", () => {
    expect(ticksWith(miniModel(`every 3: a += 10 "drip"`), "drip")).toEqual([3, 6, 9, 12]);
    expect(ticksWith(miniModel(`every 3 from 1: a += 10 "drip"`), "drip")).toEqual([1, 4, 7, 10]);
    expect(ticksWith(miniModel(`every 1/q: a += 10 "drip"`), "drip")).toEqual([3, 6, 9, 12]);
  });

  it("once and between", () => {
    expect(ticksWith(miniModel(`once 4: a += 100 "grant"`), "grant")).toEqual([4]);
    expect(ticksWith(miniModel(`between 2..4: a += 10 "window"`), "window")).toEqual([2, 3, 4]);
  });

  it("when and unless gate on state and tick", () => {
    const spec = { stocks: { a: 25, b: 0 }, horizon: { start: 0, end: 4, unit: "month" as const } };
    const m = model({
      ...spec,
      rules: mini(`
        a -= 10                       "drain"
        when a > 0: b += 1            "bonus"
        unless a > 0: b += 99         "refill trigger"
      `),
    });
    const history = run(m);
    expect(history[2]!.stocks).toEqual({ a: 5, b: 2 });
    // at t=3 the drain pushes a<=0: the bonus stops and the refill fires
    expect(history[3]!.stocks).toEqual({ a: -5, b: 101 });
    expect(history[4]!.stocks.b).toBe(200);
  });

  it("guards compose with && and || at the right precedence", () => {
    const m = miniModel(`when t >= 2 && t <= 4 || t >= 10: a += 1 "gate"`);
    expect(ticksWith(m, "gate")).toEqual([2, 3, 4, 10, 11, 12]);
  });

  it("prefixes nest (every inside when and back)", () => {
    expect(ticksWith(miniModel(`every 2: when t >= 4: a += 1 "nested"`), "nested")).toEqual([4, 6, 8, 10, 12]);
    expect(ticksWith(miniModel(`when true: every 3: a += 1 "outer"`), "outer")).toEqual([3, 6, 9, 12]);
  });

  it("date fields gate on the civil calendar", () => {
    const m = model({
      horizon: { start: 0, end: 24, unit: "month", convention: "actual/365", basis: date("2043-01-10") },
      stocks: { a: 0 },
      rules: mini(`when year >= 2044: a += 1 "after 2044"`),
    });
    const ticks = ticksWith(m, "after 2044");
    expect(ticks[0]).toBe(12);
    expect(ticks).toHaveLength(13);
  });

  it("date gating without a basis reports the missing basis, not a parse error", () => {
    const m = miniModel(`when month == 1: a += 1 "jan"`);
    expect(() => run(m)).toThrow(/no calendar basis/);
  });
});

describe("mini: transfers", () => {
  it("a -> b moves amounts with the colon optional", () => {
    const m = model({
      horizon: { start: 0, end: 2, unit: "month" },
      stocks: { ira: 1000, cash: 0 },
      rules: mini(`
        ira -> cash: 100 "withhold"
        ira -> cash 25   "no colon"
      `),
    });
    expect(run(m)[1]!.stocks).toEqual({ ira: 875, cash: 125 });
  });
});

describe("mini: derived blocks", () => {
  it("derived names chain and can read stocks/constants/tick", () => {
    const m = model({
      horizon: { start: 0, end: 2, unit: "month" },
      constants: { fee: 1 },
      stocks: { a: 0 },
      rules: mini(`a += 10 "fill"`),
      derived: miniDerived(`
        ~gross = a
        ~net   = gross - fee
        ~age   = t
      `),
    });
    const history = run(m);
    expect(history[2]!.derived).toEqual({ gross: 20, net: 19, age: 2 });
  });

  it("forward references throw with the acyclic message", () => {
    const m = model({
      horizon: { start: 0, end: 1, unit: "month" },
      stocks: { a: 0 },
      rules: [],
      derived: miniDerived(`
        ~first = second
        ~second = 1
      `),
    });
    expect(() => run(m)).toThrow(/acyclic/);
  });
});

describe("mini: layout", () => {
  it("blank lines and # comments are skipped; ; separates statements", () => {
    const m = miniModel(`
      # a comment

      a += 1 "one"; a += 2 "two"
    `);
    expect(run(m)[1]!.stocks.a).toBe(3);
    expect(ticksWith(m, "one")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("labels are optional and default to the statement text", () => {
    const m = miniModel(`a += 10`);
    expect(ticksWith(m, "a += 10")).toContain(1);
  });

  it("labels can carry escaped quotes", () => {
    const m = miniModel(`a += 1 "say \\"hi\\""`);
    expect(run(m)[1]!.deltas[0]!.rule).toBe('say "hi"');
  });
});

describe("mini: provenance", () => {
  it("locs carry the host file, the statement text (minus label), and a line offset", () => {
    const rules = mini(`
      a += 1 "one"
      b -> a: lag(b, 1)
    `, { loc: { file: "host.ts", line: 100, column: 7 } });
    expect(rules[0]!.loc).toMatchObject({ file: "host.ts", line: 101, text: "a += 1" });
    expect(rules[1]!.loc).toMatchObject({ line: 102, text: "b -> a: lag(b, 1)" });
  });

  it("captured locs point at the mini() call site", () => {
    const rules = mini(`a += 1`);
    expect(rules[0]!.loc?.file).toContain("mini.test.ts");
    expect(typeof rules[0]!.loc?.line).toBe("number");
  });

  it("deltas from sugar rules keep provenance through the fold", () => {
    const history = run(miniModel(`a += 1 "seen"`));
    const d = history[1]!.deltas[0]!;
    expect(d.rule).toBe("seen");
    expect(d.loc?.text).toBe("a += 1");
    expect(d.loc?.file).toContain("mini.test.ts");
  });
});

describe("mini: errors", () => {
  const bad = (src: string) => () => mini(src);

  it("rejects statements without an action operator", () => {
    expect(bad("a 5")).toThrow(/expected '\+=', '-=', or '->' after 'a'/);
  });

  it("rejects trailing junk", () => {
    expect(bad("a += 1 2")).toThrow(/unexpected '2'/);
  });

  it("rejects unknown functions", () => {
    expect(bad("a += nope(1)")).toThrow(/unknown function 'nope\(\)'/);
  });

  it("rejects wrong arity", () => {
    expect(bad("a += min(1)")).toThrow(/min\(\) takes 2 argument\(s\), got 1/);
  });

  it("rejects unknown units after '/' in schedules", () => {
    expect(bad("every 5/fortnight: a += 1")).toThrow(/unknown unit 'fortnight'/);
  });

  it("rejects malformed numbers", () => {
    expect(bad("a += 3kind")).toThrow(/invalid number/);
  });

  it("rejects unterminated strings and stray characters", () => {
    expect(bad('a += 1 "oops')).toThrow(/unterminated string/);
    expect(bad("a += $1")).toThrow(/unexpected character '\$'/);
  });

  it("routes '~' declarations to miniDerived()", () => {
    expect(bad("~x = 1")).toThrow(/miniDerived\(\) block/);
  });

  it("requires '~' statements inside miniDerived()", () => {
    expect(() => miniDerived("a += 1")).toThrow(/~name = expr/);
  });

  it("rejects labels on derived values", () => {
    expect(() => miniDerived('~x = 1 "no"')).toThrow(/take no label/);
  });

  it("requires a colon after prefixes", () => {
    expect(bad("every 3 a += 1")).toThrow(/expected ':'/);
  });

  it("rejects fractional schedule ticks", () => {
    expect(bad("once 1.5: a += 1")).toThrow(/whole number/);
  });

  it("reports the host line in parse errors", () => {
    expect(() => mini("a += 1\nb 2", { loc: { line: 40 } })).toThrow(/mini: line 41/);
  });

  it("unknown names throw at fold time with the statement location", () => {
    const m = miniModel(`a += mystery "mystery rule"`);
    expect(() => run(m)).toThrow(/unknown name 'mystery'/);
  });

  it("unknown flow stocks are caught at build time by model()", () => {
    expect(() => model({ horizon: { start: 0, end: 1, unit: "month" }, stocks: { a: 1 }, rules: mini(`ghost += 1`) })).toThrow(
      /references unknown stock 'ghost'/,
    );
  });

  it("empty sugar blocks are legal", () => {
    expect(mini("# nothing here\n")).toEqual([]);
    expect(miniDerived("")).toEqual([]);
  });
});
