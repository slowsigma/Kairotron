import { describe, expect, it } from "vitest";
import { fork } from "../src/core/fold.js";
import type { Delta, Snapshot } from "../src/core/types.js";
import { model } from "../src/dsl/model.js";
import { formatTable } from "../src/outputs/table.js";

// These sizes exceed the argument-count limit that `fn(...bigArray)` hits on
// V8, so they guard against regressing to spread-into-call.
const N = 200_000;

function bigHistory(length: number): Snapshot[] {
  const stocks = Object.freeze({ a: 0 });
  const derived = Object.freeze({});
  const deltas = Object.freeze([]) as readonly Delta[];
  return Array.from({ length }, (_, t) => ({ t, unit: "month" as const, stocks, derived, deltas }));
}

describe("large histories", () => {
  it("formats a table without spreading rows into Math.max", () => {
    const out = formatTable(bigHistory(N));
    expect(out.split("\n")).toHaveLength(N + 2); // header + separator + rows
  });

  it("forks a prefix without spreading snapshots into push", () => {
    const trunk = bigHistory(N + 1); // t = 0..N
    const variant = model({
      horizon: { start: 0, end: N + 1, unit: "month" },
      stocks: { a: 0 },
      rules: [],
    });
    const branch = fork(trunk, N, variant);
    expect(branch.snapshots).toHaveLength(N + 2);
    expect(branch.snapshots[N]).toBe(trunk[N]);
    expect(branch.snapshots[N + 1]!.t).toBe(N + 1);
  });
});
