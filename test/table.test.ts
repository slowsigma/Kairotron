import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { formatCsv, formatFlows, formatTable } from "../src/outputs/table.js";
import { flow, model } from "../src/dsl/model.js";

const simple = () =>
  run(
    model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { pot: 100 },
      rules: [flow("pot", 10, "save")],
    }),
  );

describe("formatCsv", () => {
  it("quotes stock names containing commas per RFC 4180", () => {
    const history = run(
      model({
        horizon: { start: 0, end: 1, unit: "month" },
        stocks: { "store, marked": 10 },
        rules: [flow("store, marked", 5, "add")],
      }),
    );
    const lines = formatCsv(history).split("\n");
    expect(lines).toEqual(['t,"store, marked"', "0,10", "1,15"]);
  });

  it("doubles embedded quotes", () => {
    const history = run(
      model({
        horizon: { start: 0, end: 0, unit: "month" },
        stocks: { 'say "hi"': 0 },
        rules: [],
      }),
    );
    const lines = formatCsv(history).split("\n");
    expect(lines[0]).toBe('t,"say ""hi"""');
  });

  it("leaves plain names untouched and round-trips a standard example", () => {
    const lines = formatCsv(simple()).split("\n");
    expect(lines[0]).toBe("t,pot");
    expect(lines[1]).toBe("0,100");
    expect(lines[4]).toBe("3,130");
  });
});

describe("table/flows renderers are unchanged for tame output", () => {
  it("formatTable still aligns columns (right-aligned cells, dashes rule)", () => {
    const lines = formatTable(simple()).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]!.startsWith("t")).toBe(true);
    expect(lines[1]!.startsWith("-")).toBe(true);
    expect(lines[4]!.replace(/\s/g, "")).toBe("2120.00");
    expect(lines[4]!.match(/[^0-9.\s]/)).toBeNull();
  });

  it("formatFlows lists per-tick deltas under t= headers with provenance", () => {
    const out = formatFlows(simple());
    expect(out).toContain("t=1");
    expect(out).toContain("+10.00  pot          save  @");
    expect(out).toBe(out.trimEnd());
  });
});
