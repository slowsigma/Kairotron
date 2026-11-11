import { describe, expect, it } from "vitest";
import { run } from "../src/core/fold.js";
import { compileModel } from "../web/src/repl.js";
import { SAMPLE } from "../web/src/sample.js";

const { model } = compileModel(SAMPLE);
const history = run(model);
const hasContribution = (t: number): boolean =>
  history[t]!.deltas.some((d) => d.rule === "contribution");

describe("sample model", () => {
  it("stops contributions after 25 yearly ticks", () => {
    expect(hasContribution(25)).toBe(true);
    expect(hasContribution(26)).toBe(false);
  });
});
