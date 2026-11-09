import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { derived, flow, model, rate } from "../src/dsl/model.js";
import { formatCsv, formatTable } from "../src/outputs/table.js";

describe("derived quantities", () => {
  const m = model({
    horizon: { start: 0, end: 3, unit: "month" },
    constants: { fee: rate(1, "month") },
    stocks: { a: 100, b: 0 },
    rules: [flow("a", -10, "drain"), flow("b", (c) => c.perTick("fee"), "fee")],
    derived: [
      derived("total", (c) => c.stocks.a + c.stocks.b),
      derived("doubled", (c) => 2 * c.derived.total),
    ],
  });

  it("is attached to every snapshot, including S0, and may chain off earlier ones", () => {
    const h = run(m);
    expect(h[0]!.derived.total).toBe(100);
    expect(h[0]!.derived.doubled).toBe(200);
    expect(h[1]!.derived.total).toBeCloseTo(100 - 10 + 1, 8);
    expect(h[3]!.derived.doubled).toBeCloseTo(2 * h[3]!.derived.total!, 8);
  });

  it("does not affect the fold at all", () => {
    const without = model({
      horizon: { start: 0, end: 3, unit: "month" },
      constants: { fee: rate(1, "month") },
      stocks: { a: 100, b: 0 },
      rules: [flow("a", -10, "drain"), flow("b", (c) => c.perTick("fee"), "fee")],
    });
    const a = run(m).map((s) => s.stocks);
    const b = run(without).map((s) => s.stocks);
    expect(a).toEqual(b);
  });

  it("rejects forward references (the derivation graph stays acyclic)", () => {
    const bad = model({
      horizon: { start: 0, end: 2, unit: "month" },
      stocks: { a: 1 },
      rules: [],
      derived: [
        derived("second", (c) => c.derived.first + 1),
        derived("first", () => 1),
      ],
    });
    expect(() => run(bad)).toThrow(/acyclic/);
  });

  it("rejects references to unknown derived names", () => {
    const bad = model({
      horizon: { start: 0, end: 2, unit: "month" },
      stocks: { a: 1 },
      rules: [],
      derived: [derived("x", (c) => (c.derived as Record<string, number>).nope)],
    });
    expect(() => run(bad)).toThrow(/unknown or forward-referenced derived 'nope'/);
  });

  it("rejects non-finite derivations by name", () => {
    const bad = model({
      horizon: { start: 0, end: 2, unit: "month" },
      stocks: { a: 1 },
      rules: [],
      derived: [derived("bad", (c) => c.stocks.a / 0)],
    });
    expect(() => run(bad)).toThrow(/derived 'bad' produced non-finite/);
  });

  it("rejects name collisions and duplicates at build time", () => {
    const collide = () =>
      model({
        horizon: { start: 0, end: 1, unit: "month" },
        constants: { fee: 1 },
        stocks: { a: 1 },
        rules: [],
        derived: [derived("a", () => 1)],
      });
    expect(collide).toThrow(/collides/);
    const dupe = () =>
      model({
        horizon: { start: 0, end: 1, unit: "month" },
        stocks: { a: 1 },
        rules: [],
        derived: [derived("x", () => 1), derived("x", () => 2)],
      });
    expect(dupe).toThrow(/duplicate derived name 'x'/);
    expect(() => derived("t", () => 1)).toThrow(/reserved/);
  });

  it("is read-only: the derivation sees frozen state, and snapshots expose frozen derived", () => {
    const mutating = model({
      horizon: { start: 0, end: 1, unit: "month" },
      stocks: { a: 1 },
      rules: [],
      derived: [
        derived("bad", (c) => {
          (c.stocks as Record<string, number>).a = 0;
          return 1;
        }),
      ],
    });
    expect(() => run(mutating)).toThrow(TypeError);
    const h = run(m);
    expect(() => {
      (h[0]!.derived as Record<string, number>).total = 0;
    }).toThrow(TypeError);
  });

  it("surfaces as ~columns in the table and plain columns in CSV", () => {
    const table = formatTable(run(m));
    expect(table.split("\n")[0]).toMatch(/~total\s+~doubled/);
    expect(formatCsv(run(m)).split("\n")[0]).toBe("t,a,b,total,doubled");
  });
});
