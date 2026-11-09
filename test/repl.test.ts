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

  describe("horizonOverride", () => {
    const base = { start: 0, end: 40, unit: "year" } as const;
    it("returns undefined when the UI leaves everything on auto", () => {
      expect(horizonOverride("", "", "", base)).toBeUndefined();
    });
    it("applies the edits that are set", () => {
      expect(horizonOverride("", "80", "", base)).toEqual({ start: 0, end: 80, unit: "year" });
      expect(horizonOverride("2", "10", "month", base)).toEqual({ start: 2, end: 10, unit: "month" });
    });
    it("rejects nonsense", () => {
      expect(() => horizonOverride("", "soon", "", base)).toThrow(/must be numbers/);
      expect(() => horizonOverride("5", "5", "", base)).toThrow(/must exceed/);
    });
  });
});
