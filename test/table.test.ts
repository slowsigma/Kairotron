import { describe, expect, it } from "vitest";
import { fork, run } from "../src/core/fold.js";
import { formatCsv, formatDiff, formatFlows, formatTable } from "../src/outputs/table.js";
import { flow, derived, model } from "../src/dsl/model.js";

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

  it("emits empty fields for stocks/derivations absent from a fork prefix", () => {
    const trunk = simple();
    const variant = model({
      horizon: { start: 0, end: 5, unit: "month" },
      stocks: { pot: 0, seed: 7 },
      rules: [flow("pot", 10, "save")],
      derived: [derived("big", (c) => c.stocks.pot + c.stocks.seed)],
    });
    const lines = formatCsv(fork(trunk, 3, variant).snapshots).split("\n");
    expect(lines[0]).toBe("t,pot,seed,big");
    expect(lines[1]).toBe("0,100,,"); // no seed / ~big yet, not fake zeros
    expect(lines[4]).toBe("3,130,,"); // the fork tick is still the shared prefix
    expect(lines[5]).toBe("4,140,7,147"); // the variant enters on its first tick
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

describe("formatDiff", () => {
  it("prints branch-minus-trunk deltas only after the fork point", () => {
    const trunk = simple(); // pot +10/tick
    const variant = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { pot: 0 },
      rules: [flow("pot", 25, "save harder")],
    });
    const branch = fork(trunk, 2, variant);
    const lines = formatDiff(trunk, branch).split("\n");
    expect(lines[0]!.trim().replace(/\s+/g, ",")).toBe("t,Δpot");
    // one divergent tick (t=3): +25 on the branch vs +10 on the trunk
    expect(lines.slice(2).map((l) => l.trim().replace(/\s+/g, ","))).toEqual([
      "3,+15.00",
    ]);
  });

  it("marks a dash where the trunk has no tick to subtract", () => {
    const trunk = simple(); // ends at t=3
    const longer = model({
      horizon: { start: 0, end: 5, unit: "month" },
      stocks: { pot: 0 },
      rules: [flow("pot", 10, "save")],
    });
    const branch = fork(trunk, 3, longer);
    const lines = formatDiff(trunk, branch).split("\n");
    expect(lines[2]!.trim().replace(/\s+/g, ",")).toBe("4,—");
    expect(lines[3]!.trim().replace(/\s+/g, ",")).toBe("5,—");
  });
});

describe("formatTable across a fork", () => {
  it("dashes stocks and derivations the variant introduced mid-run, instead of printing a fake 0.00", () => {
    const trunk = simple();
    const variant = model({
      horizon: { start: 0, end: 5, unit: "month" },
      stocks: { pot: 0, seed: 7 },
      rules: [flow("pot", 10, "save")],
      derived: [derived("big", (c) => c.stocks.pot + c.stocks.seed)],
    });
    const b = fork(trunk, 3, variant);
    const lines = formatTable(b.snapshots).split("\n");
    expect(lines[0]!.trim().replace(/\s+/g, ",")).toBe("t,pot,seed,~big");
    expect(lines[1]!.trim().replace(/\s+/g, ",")).toBe("-,------,----,------"); // the separator
    expect(lines[2]!.trim().replace(/\s+/g, ",")).toBe("0,100.00,—,—"); // shared prefix: no seed, no ~big
    expect(lines[5]!.trim().replace(/\s+/g, ",")).toBe("3,130.00,—,—"); // the fork tick is still the trunk's shared snapshot
    expect(lines[6]!.trim().replace(/\s+/g, ",")).toBe("4,140.00,7.00,147.00"); // the variant enters on its first tick
  });
});
