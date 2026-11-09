import { describe, expect, it } from "vitest";
import { TICK_UNITS, isTickUnit, normalizeRate } from "../src/core/units.js";

describe("rate normalization", () => {
  it("7%/year becomes 7/12 per monthly tick", () => {
    expect(normalizeRate(0.07, "year", "month")).toBeCloseTo(0.07 / 12, 12);
  });

  it("7%/year becomes 7/52 per weekly tick", () => {
    expect(normalizeRate(0.07, "year", "week")).toBeCloseTo(0.07 / 52, 12);
  });

  it("a rate already per the tick unit is unchanged", () => {
    expect(normalizeRate(0.02, "month", "month")).toBeCloseTo(0.02, 12);
  });

  it("per-month volume converts to per-day (365-day year, 12 months)", () => {
    expect(normalizeRate(180, "month", "day")).toBeCloseTo((180 * 12) / 365, 10);
  });

  it("conversion is consistent across unit chains", () => {
    const perDay = normalizeRate(0.07, "year", "day");
    const chained = normalizeRate(normalizeRate(0.07, "year", "month"), "month", "day");
    expect(perDay).toBeCloseTo(chained, 10);
  });
});

describe("tick units", () => {
  it("accepts the eight supported units", () => {
    expect(TICK_UNITS).toEqual([
      "second",
      "minute",
      "hour",
      "day",
      "week",
      "month",
      "quarter",
      "year",
    ]);
    for (const u of TICK_UNITS) expect(isTickUnit(u)).toBe(true);
    expect(isTickUnit("fortnight")).toBe(false);
  });
});
