import { describe, expect, it } from "vitest";
import {
  calDate,
  formatCalDate,
  msToTick,
  parseDate,
  tickToMs,
  whenDate,
} from "../src/core/calendar.js";
import { fork, run } from "../src/core/fold.js";
import { retickHorizon } from "../src/core/units.js";
import { date, derived, flow, model, when } from "../src/dsl/model.js";
import { formatCsv, formatDiff, formatTable } from "../src/outputs/table.js";
import { horizonOverride } from "../web/src/repl.js";
import type { Model, TickContext, TickUnit } from "../src/core/types.js";

const jan31_2000 = parseDate("2000-01-31");

describe("parseDate", () => {
  it("accepts calendar dates and optional UTC times", () => {
    expect(parseDate("2000-02-29")).toBe(Date.UTC(2000, 1, 29));
    expect(parseDate("2021-03-05T08:30")).toBe(Date.UTC(2021, 2, 5, 8, 30));
    expect(parseDate("2021-03-05 08:30:45")).toBe(Date.UTC(2021, 2, 5, 8, 30, 45));
  });

  it("rejects nonexistent civil dates instead of rolling over", () => {
    expect(() => parseDate("2001-02-29")).toThrow(/does not exist/);
    expect(() => parseDate("2021-02-30")).toThrow(/does not exist/);
    expect(() => parseDate("2021-13-01")).toThrow(/does not exist/);
    expect(() => parseDate("2021-03-05T25:00")).toThrow(/does not exist/);
    // Date.UTC maps 2-digit years to the 1900s; the round-trip must catch it
    expect(() => parseDate("0050-01-01")).toThrow(/does not exist/);
  });

  it("rejects malformed shapes", () => {
    expect(() => parseDate("15/03/1971")).toThrow(/expected 'YYYY-MM-DD'/);
    expect(() => parseDate("2021-3-5")).toThrow(/expected 'YYYY-MM-DD'/);
    expect(() => parseDate("yesterday")).toThrow(/expected 'YYYY-MM-DD'/);
  });

  it("round-trips through formatCalDate", () => {
    expect(formatCalDate(parseDate("2048-06-15"))).toBe("2048-06-15");
    expect(formatCalDate(parseDate("2048-06-15T07:05"))).toBe("2048-06-15 07:05");
    expect(formatCalDate(parseDate("2048-06-15T07:05:09"))).toBe("2048-06-15 07:05:09");
  });
});

describe("tickToMs — civil stepping (actual/365 with a basis)", () => {
  it("monthly ticks step the civil calendar, clamping to February — leap-true", () => {
    expect(formatCalDate(tickToMs(1, "month", jan31_2000, "actual/365"))).toBe("2000-02-29");
    expect(formatCalDate(tickToMs(2, "month", jan31_2000, "actual/365"))).toBe("2000-03-31");
    expect(formatCalDate(tickToMs(13, "month", jan31_2000, "actual/365"))).toBe("2001-02-28");
  });

  it("quarter and year ticks land on the same civil day-of-month", () => {
    expect(formatCalDate(tickToMs(4, "quarter", jan31_2000, "actual/365"))).toBe("2001-01-31");
    expect(formatCalDate(tickToMs(1, "year", jan31_2000, "actual/365"))).toBe("2001-01-31");
    // born on a leap day: the birthday clamps to the 28th in common years
    const leap = parseDate("2000-02-29");
    expect(formatCalDate(tickToMs(1, "year", leap, "actual/365"))).toBe("2001-02-28");
    expect(formatCalDate(tickToMs(4, "year", leap, "actual/365"))).toBe("2004-02-29");
  });

  it("carries the basis time-of-day across calendar steps", () => {
    const withTime = parseDate("2020-01-15T06:30");
    expect(formatCalDate(tickToMs(1, "month", withTime, "actual/365"))).toBe("2020-02-15 06:30");
  });

  it("walks backwards through the civil calendar", () => {
    expect(formatCalDate(tickToMs(-1, "month", jan31_2000, "actual/365"))).toBe("1999-12-31");
    expect(formatCalDate(tickToMs(-10, "month", jan31_2000, "actual/365"))).toBe("1999-03-31");
  });
});

describe("tickToMs — 30/360 notional months", () => {
  it("anchors tick 0 at the declared basis, even on the 31st", () => {
    expect(tickToMs(0, "month", jan31_2000, "30/360")).toBe(jan31_2000);
    expect(tickToMs(0, "quarter", jan31_2000, "30/360")).toBe(jan31_2000);
    expect(tickToMs(0, "year", jan31_2000, "30/360")).toBe(jan31_2000);
    expect(whenDate(0, "month", jan31_2000, "30/360").iso).toBe("2000-01-31");
    expect(msToTick(jan31_2000, "month", jan31_2000, "30/360")).toBe(0);
    expect(msToTick(jan31_2000, "year", jan31_2000, "30/360")).toBe(0);
  });

  it("anchors the day-of-month at 30 before stepping", () => {
    // 31 Jan → Feb 30 doesn't exist even notionally, so it clamps to month end;
    // from March on the anchor sits at 30, never reaching the 31st
    expect(formatCalDate(tickToMs(1, "month", jan31_2000, "30/360"))).toBe("2000-02-29");
    expect(formatCalDate(tickToMs(2, "month", jan31_2000, "30/360"))).toBe("2000-03-30");
    expect(formatCalDate(tickToMs(12, "month", jan31_2000, "30/360"))).toBe("2001-01-30");
    expect(formatCalDate(tickToMs(1, "year", jan31_2000, "30/360"))).toBe("2001-01-30");
  });
});

describe("tickToMs — exact ratio paths", () => {
  it("day and week ticks are real days, leap years included", () => {
    const feb28 = parseDate("2020-02-28");
    expect(formatCalDate(tickToMs(1, "day", feb28, "actual/365"))).toBe("2020-02-29");
    expect(formatCalDate(tickToMs(1, "week", feb28, "actual/365"))).toBe("2020-03-06");
  });

  it("sub-day ticks land on whole seconds", () => {
    const midnight = parseDate("2020-01-01");
    expect(formatCalDate(tickToMs(25, "hour", midnight, "actual/365"))).toBe("2020-01-02 01:00");
    expect(formatCalDate(tickToMs(90, "second", midnight, "abstract"))).toBe("2020-01-01 00:01:30");
  });

  it("abstract months are 30⅓ exact days — not civil months", () => {
    const midnight = parseDate("2020-01-01");
    expect(tickToMs(1, "month", midnight, "abstract") - midnight).toBe(2_620_800_000);
    expect(formatCalDate(tickToMs(1, "month", midnight, "abstract"))).toBe("2020-01-31 08:00");
  });

  it("rejects non-whole ticks and broken bases", () => {
    expect(() => tickToMs(1.5, "month", jan31_2000, "actual/365")).toThrow(/whole tick/);
    expect(() => tickToMs(1, "month", Number.NaN, "actual/365")).toThrow(/finite timestamp/);
  });
});

describe("whenDate — the when(t, tickUnit, basis) overlay", () => {
  it("defaults to the civil calendar (actual/365)", () => {
    const d = whenDate(1, "month", jan31_2000);
    expect([d.year, d.month, d.day, d.iso]).toEqual([2000, 2, 29, "2000-02-29"]);
    expect(d.ms).toBe(Date.UTC(2000, 1, 29));
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("honours an explicit convention", () => {
    expect(whenDate(2, "month", jan31_2000, "30/360").iso).toBe("2000-03-30");
  });

  it("exposes seconds through calDate", () => {
    const d = calDate(parseDate("2021-07-04T23:59:01"));
    expect([d.hours, d.minutes, d.seconds]).toEqual([23, 59, 1]);
    expect(d.iso).toBe("2021-07-04 23:59:01");
  });
});

describe("when() in the DSL — gating on civil dates", () => {
  const dated: Model = model({
    horizon: { start: 0, end: 12, unit: "month", convention: "actual/365", basis: jan31_2000 },
    stocks: { pot: 0 },
    rules: [
      // the plan.md idiom: gate a rule on a date computed from t + basis
      when((c) => c.when().year >= 2001, flow("pot", 10, "new century")),
    ],
  });

  it("when(t, unit, basis, convention) returns a CalendarDate", () => {
    expect(when(1, "month", jan31_2000, "actual/365").iso).toBe("2000-02-29");
    expect(when(2, "month", jan31_2000, "30/360").iso).toBe("2000-03-30");
    expect(() => when(1, "fortnight" as TickUnit, jan31_2000, "actual/365")).toThrow(
      /unknown tick unit 'fortnight'/,
    );
    expect(() => when(1, "month", jan31_2000, "act/360" as "actual/365")).toThrow(
      /unknown day-count convention/,
    );
    // the convention is mandatory: the free function cannot see the model
    // @ts-expect-error — three arguments are a compile error as well as a runtime one
    expect(() => when(1, "month", jan31_2000)).toThrow(/pass the model's day-count convention/);
  });

  it("c.when()/c.date() agree with the free when(...) under 30/360", () => {
    let byCtx: ReturnType<TickContext["when"]> | undefined;
    let byFree: ReturnType<TickContext["when"]> | undefined;
    const m = model({
      horizon: { start: 0, end: 2, unit: "month", convention: "30/360", basis: jan31_2000 },
      stocks: { pot: 0 },
      rules: [
        flow("pot", (c) => {
          byCtx = c.when();
          byFree = when(c.t, c.horizon.unit, c.horizon.basis!, c.horizon.convention!);
          return 1;
        }, "probe"),
      ],
    });
    run(m);
    expect(byCtx!.iso).toBe("2000-03-30");
    expect(byFree!.iso).toBe(byCtx!.iso);
  });

  it("gates fire on civil dates: t=1..11 stay in 2000, t=12 crosses into 2001", () => {
    const history = run(dated);
    for (let t = 1; t <= 11; t++) expect(history[t]!.deltas).toHaveLength(0);
    expect(history[12]!.deltas[0]!.rule).toBe("new century");
    expect(history[12]!.stocks.pot).toBe(10);
  });
});

describe("model validation — the basis needs a calendar", () => {
  const base = { start: 0, end: 1, unit: "month" } as const;
  const stocks = { pot: 0 };

  it("rejects a basis under 'abstract' (declared or defaulted)", () => {
    expect(() => model({ horizon: { ...base, basis: jan31_2000 }, stocks, rules: [] })).toThrow(
      /needs a calendar convention/,
    );
    expect(() =>
      model({ horizon: { ...base, convention: "abstract", basis: jan31_2000 }, stocks, rules: [] }),
    ).toThrow(/needs a calendar convention/);
    expect(() =>
      model({ horizon: { ...base, convention: "30/360", basis: jan31_2000 }, stocks, rules: [] }),
    ).not.toThrow();
  });

  it("rejects a non-numeric basis", () => {
    expect(() => model({ horizon: { ...base, basis: Number.NaN }, stocks, rules: [] })).toThrow(
      /finite timestamp/,
    );
  });

  it("runtime override into 'abstract' is caught by the fold, not silently displayed", () => {
    const m = model({
      horizon: { ...base, convention: "actual/365", basis: jan31_2000 },
      stocks,
      rules: [],
    });
    // an override that keeps the basis but relabels the day count…
    expect(() => run(m, { ...m.horizon, convention: "abstract" })).toThrow(/no civil calendar/);
    // …a plain horizon override without a basis is just an undated re-run
    expect(() => run(m, { start: 0, end: 1, unit: "month", convention: "abstract" })).not.toThrow();
  });

  it("reading dates on an undated model is a clear error", () => {
    const m = model({
      horizon: base,
      stocks,
      rules: [flow("pot", (c) => c.date().year, "date leak")],
    });
    expect(() => run(m)).toThrow(/no calendar basis/);
  });

  it("the REPL horizon keeps the basis across re-ticks", () => {
    const b = { start: 0, end: 40, unit: "year", convention: "actual/365", basis: jan31_2000 } as const;
    expect(horizonOverride("", "", "month", "", b)?.basis).toBe(jan31_2000);
    expect(horizonOverride("", "10", "", "", b)?.basis).toBe(jan31_2000);
  });
});

describe("dated fold — snapshots carry the overlay", () => {
  const m = model({
    horizon: { start: 0, end: 4, unit: "month", convention: "actual/365", basis: parseDate("2000-01-31") },
    stocks: { pot: 0 },
    rules: [flow("pot", 10, "save")],
    derived: [derived("year", (c) => c.date().year)],
  });

  it("every snapshot carries the basis; derived values can read dates", () => {
    const history = run(m);
    for (const s of history) expect(s.basis).toBe(jan31_2000);
    expect(history[0]!.derived.year).toBe(2000);
    expect(history[4]!.derived.year).toBe(2000); // through Dec 2000
    const into2001 = run(model({ ...m, horizon: { ...m.horizon, end: 12 } }));
    expect(into2001[12]!.derived.year).toBe(2001);
  });

  it("retickHorizon preserves the basis (tick 0's moment is not a duration)", () => {
    const h = { start: 0, end: 12, unit: "month", convention: "actual/365", basis: jan31_2000 } as const;
    expect(retickHorizon(h, "year")).toEqual({
      start: 0,
      end: 1,
      unit: "year",
      convention: "actual/365",
      basis: jan31_2000,
    });
  });

  it("dated re-ticks follow civil month lengths (leap-true), not fixed day ratios", () => {
    // 2000-01-31 + 12 civil months is 2001-01-31: 366 days, not 365.
    const monthly = { start: 0, end: 12, unit: "month", convention: "actual/365", basis: jan31_2000 } as const;
    expect(retickHorizon(monthly, "day")).toMatchObject({
      start: 0,
      end: 366,
      unit: "day",
      convention: "actual/365",
      basis: jan31_2000,
    });
    // 2026-01-01 + 40 years includes ten leap days.
    const yearly = {
      start: 0,
      end: 40,
      unit: "year",
      convention: "actual/365",
      basis: parseDate("2026-01-01"),
    } as const;
    expect(retickHorizon(yearly, "day").end).toBe(14610);
    // The civil conversion round-trips where the grid agrees.
    expect(retickHorizon(retickHorizon(monthly, "day"), "month").end).toBe(12);
    // A moment that falls between civil month ticks is refused, not fudged.
    expect(() =>
      retickHorizon(
        { start: 0, end: 365, unit: "day", convention: "actual/365", basis: jan31_2000 },
        "month",
      ),
    ).toThrow(/no whole 'month' tick/);
  });

  it("a same-unit fork inherits the trunk's basis onto its new ticks", () => {
    const trunk = run(m);
    const variant = model({
      horizon: { start: 0, end: 6, unit: "month" },
      stocks: { pot: 0 },
      rules: [flow("pot", 50, "save harder")],
    });
    const b = fork(trunk, 2, variant);
    expect(b.horizon.basis).toBe(jan31_2000);
    expect(b.horizon.convention).toBe("actual/365");
    for (const s of b.snapshots) expect(s.basis).toBe(jan31_2000);
  });

  it("a cross-unit fork inherits the basis and convention onto the remapped prefix", () => {
    const trunk = run(m); // monthly, actual/365, basis 2000-01-31
    const variant = model({
      horizon: { start: 0, end: 4, unit: "quarter" },
      stocks: { pot: 0 },
      rules: [flow("pot", 100, "quarterly save")],
    });
    const b = fork(trunk, 3, variant); // 3 monthly ticks = exactly one quarter
    expect(b.horizon.basis).toBe(jan31_2000);
    expect(b.horizon.convention).toBe("actual/365");
    expect(b.forkTBranch).toBe(1);
    for (const s of b.snapshots) expect(s.basis).toBe(jan31_2000);
    // quarter 1 from 2000-01-31 lands on 2000-04-30 (civil April has 30 days),
    // and quarter 4 completes the civil year on 2001-01-31
    const last = b.snapshots[b.snapshots.length - 1]!;
    expect(whenDate(1, "quarter", last.basis!, "actual/365").iso).toBe("2000-04-30");
    expect(whenDate(last.t, "quarter", last.basis!, "actual/365").iso).toBe("2001-01-31");
  });

  it("cross-unit forks align dated prefix moments by the civil calendar", () => {
    const trunk = run(m); // monthly, actual/365, basis 2000-01-31
    const daily = model({
      horizon: { start: 0, end: 366, unit: "day", convention: "actual/365" },
      stocks: { pot: 0 },
      rules: [flow("pot", 10, "daily save")],
    });
    const b = fork(trunk, 3, daily); // month 3 = 2000-04-30 = day 90
    expect(b.horizon.basis).toBe(jan31_2000);
    expect(b.forkTBranch).toBe(90);
    // Jan 31 → Feb 29 → Mar 31 → Apr 30 are exact daily moments.
    expect(b.snapshots.map((s) => s.t).slice(0, 4)).toEqual([0, 29, 60, 90]);
    expect(b.snapshots[1]!.stocks.pot).toBe(trunk[1]!.stocks.pot);
    expect(b.snapshots[2]!.stocks.pot).toBe(trunk[2]!.stocks.pot);
    expect(b.snapshots.find((s) => s.t === 91)!.stocks.pot).toBe(trunk[3]!.stocks.pot! + 10);
    // Δ-vs-trunk aligns the daily branch to the trunk's civil months.
    const diff = formatDiff(trunk, b);
    expect(diff).toMatch(/\n\s*91\s+\+10\.00/);
  });

  it("a fork whose variant declares its own basis keeps it", () => {
    const trunk = run(m);
    const own = model({
      horizon: { start: 0, end: 6, unit: "month", convention: "actual/365", basis: parseDate("2030-01-01") },
      stocks: { pot: 0 },
      rules: [flow("pot", 50, "save harder")],
    });
    const b = fork(trunk, 2, own);
    expect(b.horizon.basis).toBe(parseDate("2030-01-01"));
    // the new ticks anchor to the variant's own basis…
    expect(b.snapshots[b.snapshots.length - 1]!.basis).toBe(parseDate("2030-01-01"));
    // …while the shared prefix keeps the trunk's (immutable snapshots)
    expect(b.snapshots[0]!.basis).toBe(jan31_2000);
    // A re-based timeline has no common moments with the trunk after the
    // fork, so Δ-vs-trunk must not pretend tick 3 is the same instant.
    expect(formatDiff(trunk, b)).not.toMatch(/\+/);

    // Nor may a basis before the trunk's first tick be clamped onto it.
    const early = model({
      horizon: { start: 0, end: 6, unit: "month", convention: "actual/365", basis: parseDate("1990-01-01") },
      stocks: { pot: 0 },
      rules: [flow("pot", 50, "save harder")],
    });
    const e = fork(trunk, 2, early);
    expect(formatDiff(trunk, e)).not.toMatch(/\+/);
  });
});

describe("calendar display in outputs", () => {
  const m = model({
    horizon: { start: 0, end: 12, unit: "month", convention: "actual/365", basis: parseDate("1975-06-15") },
    stocks: { pot: 100 },
    rules: [flow("pot", 10, "save")],
    derived: [derived("dbl", (c) => c.stocks.pot * 2)],
  });
  const history = run(m);

  it("formatTable gains a date column when the timeline is dated", () => {
    const lines = formatTable(history).split("\n");
    expect(lines[0]!.trim().replace(/\s+/g, ",")).toBe("t,date,pot,~dbl");
    expect(lines[2]).toContain("1975-06-15"); // t=0 is the basis
    expect(lines[2 + 12]).toContain("1976-06-15"); // 12 civil months later
  });

  it("formatCsv gains a date column", () => {
    const lines = formatCsv(history).split("\n");
    expect(lines[0]).toBe("t,date,pot,dbl");
    expect(lines[1]).toBe("0,1975-06-15,100,200");
    expect(lines[13]).toBe("12,1976-06-15,220,440");
  });

  it("undated timelines are unaffected", () => {
    const undated = model({
      horizon: { start: 0, end: 2, unit: "month" },
      stocks: { pot: 0 },
      rules: [flow("pot", 10, "save")],
    });
    const lines = formatCsv(run(undated)).split("\n");
    expect(lines[0]).toBe("t,pot");
    expect(lines[1]).toBe("0,0");
  });

  it("a dated variant over an undated trunk dashes the undated prefix", () => {
    const undatedTrunk = model({
      horizon: { start: 0, end: 3, unit: "month" },
      stocks: { pot: 100 },
      rules: [flow("pot", 10, "save")],
    });
    const datedVariant = model({
      horizon: { start: 0, end: 5, unit: "month", convention: "actual/365", basis: parseDate("2000-01-01") },
      stocks: { pot: 0 },
      rules: [flow("pot", 10, "save")],
    });
    const lines = formatTable(fork(run(undatedTrunk), 3, datedVariant).snapshots).split("\n");
    expect(lines[0]!.trim().replace(/\s+/g, ",")).toBe("t,date,pot");
    expect(lines[2]).toContain("—"); // prefix snapshot: no basis to anchor it
    expect(lines[2 + 4]).toContain("2000-05-01"); // the variant's own ticks are dated
  });

  it("date gating survives a re-tick (c.date() follows the branch's unit)", () => {
    const m2 = model({
      horizon: { start: 0, end: 4, unit: "quarter", convention: "actual/365", basis: parseDate("2000-01-31") },
      stocks: { pot: 0 },
      rules: [flow("pot", (c) => c.date().day, "day-of-month")],
    });
    const history2 = run(m2);
    // quarter ticks from Jan 31: Apr 30, Jul 31, Oct 31, Jan 31
    expect([history2[1]!.stocks.pot, history2[2]!.stocks.pot]).toEqual([30, 61]);
    const yearly = run(m2, retickHorizon(m2.horizon, "year") );
    // one year tick from Jan 31 → Jan 31
    expect(yearly[1]!.stocks.pot).toBe(31);
  });
});

describe("tick contexts expose the overlay", () => {
  it("TickContext exposes horizon.basis and a frozen CalendarDate at any whole tick", () => {
    let seen: ReturnType<TickContext["date"]> | undefined;
    let before: ReturnType<TickContext["date"]> | undefined;
    const m = model({
      horizon: { start: 0, end: 2, unit: "month", convention: "actual/365", basis: jan31_2000 },
      stocks: { pot: 0 },
      rules: [
        flow("pot", (c) => {
          seen = c.date();
          before = c.date(c.t - 1);
          return 1;
        }, "probe"),
      ],
    });
    run(m);
    expect(seen!.iso).toBe("2000-03-31");
    expect(before!.iso).toBe("2000-02-29");
    expect(Object.isFrozen(seen)).toBe(true);
    expect(() => Object.assign(seen as unknown as { year: number }, { year: 1 })).toThrow();
  });
});
