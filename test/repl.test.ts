import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { compileModel, horizonOverride, userLine } from "../web/src/repl.js";

const CODE = `model({
  horizon: { start: 0, end: 3, unit: "month" },
  constants: { fee: rate(1, "month") },
  stocks: { a: 100, b: 0 },
  rules: [
    flow("a", -10, "drain"),
    flow("b", (c) => c.perTick("fee"), "fee"),
  ],
  derived: [derived("total", (c) => c.stocks.a + c.stocks.b)],
})
`;

describe("browser REPL compilation", () => {
  it("evaluates model code with the DSL in scope", () => {
    const history = run(compileModel(CODE).model);
    expect(history).toHaveLength(4);
    expect(history[3].stocks.a).toBeCloseTo(70, 8);
    expect(history[3].derived.total).toBeCloseTo(73, 8);
  });

  it("maps delta provenance back to editor line numbers (playhead highlighting)", () => {
    const compiled = compileModel(CODE);
    const history = run(compiled.model);
    const lines = CODE.split("\n");
    for (const rule of ["drain", "fee"]) {
      const delta = history[1].deltas.find((d) => d.rule === rule);
      expect(delta?.loc, `delta '${rule}' carries a location`).toBeDefined();
      const line = userLine(delta?.loc, compiled);
      const expected = lines.findIndex((l) => l.includes(`"${rule}"`)) + 1;
      expect(line, `rule '${rule}' highlights its source line`).toBe(expected);
    }
  });

  it("rejects code that isn't a model", () => {
    expect(() => compileModel("42")).toThrow(/must evaluate to model/);
    expect(() => compileModel("model({")).toThrow(/model code failed/);
    expect(() => compileModel('(() => { throw new Error("boom"); })()')).toThrow(/model code failed: boom/);
  });

  const MINI_CODE = [
    'model({',
    '  horizon: { start: 0, end: 3, unit: "month" },',
    '  constants: { fee: rate(1, "month") },',
    '  stocks: { a: 100, b: 0 },',
    '  rules: mini(`',
    '    a -= 10 "drain"',
    '  `),',
    '  derived: miniDerived(`~total = a + b`),',
    '})',
  ].join("\n");

  it("mini sugar runs under the REPL's new-Function sandbox", () => {
    const compiled = compileModel(MINI_CODE);
    const history = run(compiled.model);
    expect(history[3].stocks.a).toBe(70);
    expect(history[3].derived.total).toBe(70);
  });

  it("mini sugar provenance maps back to the editor line of the statement", () => {
    const compiled = compileModel(MINI_CODE);
    const delta = run(compiled.model)[1].deltas.find((d) => d.rule === "drain");
    // line 6 of MINI_CODE: `a -= 10` is the first line of the mini block
    expect(userLine(delta?.loc, compiled)).toBe(6);
  });

  describe("horizonOverride", () => {
    const base = { start: 0, end: 40, unit: "year" } as const;
    it("returns undefined when the UI leaves everything on auto", () => {
      expect(horizonOverride("", "", "", "", base)).toBeUndefined();
    });
    it("applies the edits that are set", () => {
      expect(horizonOverride("", "80", "", "", base)).toEqual({ start: 0, end: 80, unit: "year" });
      expect(horizonOverride("2", "10", "month", "", base)).toEqual({ start: 2, end: 10, unit: "month" });
    });
    it("re-ticks with auto bounds: duration-preserving, not raw", () => {
      // 40 years = 480 months = 14560 abstract days
      expect(horizonOverride("", "", "month", "", base)).toEqual({ start: 0, end: 480, unit: "month", convention: "abstract" });
      expect(horizonOverride("", "", "day", "", base)).toEqual({ start: 0, end: 14560, unit: "day", convention: "abstract" });
    });
    it("explicit bounds opt out of duration preservation (raw ticks in the new unit)", () => {
      expect(horizonOverride("", "5", "day", "", base)).toEqual({ start: 0, end: 5, unit: "day", convention: undefined });
    });
    it("a unit change that doesn't land on whole ticks is rejected", () => {
      // 100 days does not divide into whole years (100/364)
      expect(() => horizonOverride("", "", "year", "", { start: 0, end: 100, unit: "day" })).toThrow(
        /not a whole number/,
      );
    });
    it("convention relabels the horizon even at the same ticks", () => {
      expect(horizonOverride("", "", "", "30/360", base)).toEqual({ start: 0, end: 40, unit: "year", convention: "30/360" });
      // and drives the re-tick conversion
      expect(horizonOverride("", "", "day", "actual/365", { start: 0, end: 12, unit: "month" })).toEqual({
        start: 0,
        end: 365,
        unit: "day",
        convention: "actual/365",
      });
    });
    it("rejects nonsense", () => {
      expect(() => horizonOverride("", "soon", "", "", base)).toThrow(/must be numbers/);
      expect(() => horizonOverride("5", "5", "", "", base)).toThrow(/must exceed/);
    });
    it("rejects unknown unit and convention labels", () => {
      expect(() => horizonOverride("", "", "fortnight", "", base)).toThrow(/unknown tick unit 'fortnight'/);
      expect(() => horizonOverride("", "", "", "act/360", base)).toThrow(/unknown day-count convention 'act\/360'/);
    });
  });
});
