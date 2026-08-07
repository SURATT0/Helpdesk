import { describe, expect, it } from "vitest";
import {
  gapBetween,
  groupClosedLog,
  yearsIn,
  GAP_MIN_DAYS,
  GAP_MONTHS_FROM_DAYS,
} from "./closed-log";

// A Thursday, so "this week" has days either side of `now` inside it.
const NOW = new Date(2026, 7, 6, 12);
const DAY = 24 * 60 * 60 * 1000;

/** A closure `days` before NOW, at midday to stay clear of DST edges. */
const ago = (days: number) => ({
  closedAt: new Date(NOW.getTime() - days * DAY).toISOString(),
});

const group = (items: { closedAt: string | null }[]) => groupClosedLog(items);

describe("groupClosedLog — sections", () => {
  it("puts a whole calendar month under one heading", () => {
    // NOW is 6 Aug 2026; 0 and 3 days back are both August, 20 back is July.
    const groups = group([ago(0), ago(3), ago(20)]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ year: 2026, month: 7 }); // August
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1]).toMatchObject({ year: 2026, month: 6 }); // July
  });

  it("splits at the month boundary, however close the two days are", () => {
    // 1 and 2 August against 31 July: consecutive days, different sections. A
    // week-shaped section would have had to file all three under one month.
    const groups = group([ago(4), ago(5), ago(6)]);
    expect(groups.map((g) => g.month)).toEqual([7, 6]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it("names everything by its own month", () => {
    const groups = group([ago(20), ago(50)]);
    expect(groups[0]).toMatchObject({ year: 2026, month: 6 }); // July
    expect(groups[1]).toMatchObject({ year: 2026, month: 5 }); // June
  });

  it("keeps two closures in the same month together", () => {
    const groups = group([ago(20), ago(25)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it("does not merge the same month across two years", () => {
    const groups = group([ago(20), ago(385)]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
  });

  it("handles a single ticket, and an empty archive", () => {
    expect(group([ago(200)])).toHaveLength(1);
    expect(group([])).toEqual([]);
  });

  it("drops a row with no usable closing time rather than guessing one", () => {
    // The API only returns closed tickets, so this is defensive — but bucketing
    // an unknown date under "this week" would be a lie, not a fallback.
    const groups = group([ago(1), { closedAt: null }, { closedAt: "nope" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });
});

describe("gapBetween — the silences", () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY);

  it("says nothing about a short quiet stretch", () => {
    expect(gapBetween(at(0), at(1))).toBeNull();
    expect(gapBetween(at(0), at(GAP_MIN_DAYS))).toBeNull();
  });

  it("reports days just past the threshold", () => {
    expect(gapBetween(at(0), at(GAP_MIN_DAYS + 1))).toEqual({
      unit: "days",
      amount: 46,
    });
    expect(gapBetween(at(0), at(GAP_MONTHS_FROM_DAYS))).toEqual({
      unit: "days",
      amount: 60,
    });
  });

  it("switches to months once days would need converting", () => {
    expect(gapBetween(at(0), at(GAP_MONTHS_FROM_DAYS + 1))).toEqual({
      unit: "months",
      amount: 2,
    });
    expect(gapBetween(at(0), at(287))).toEqual({ unit: "months", amount: 10 });
  });

  it("never rounds a months gap down to one", () => {
    // 61 days is 2.03 months; 45 days never reaches this branch. A "1 month" gap
    // would read as shorter than the 60-day gap reported in days.
    expect(gapBetween(at(0), at(61))?.amount).toBe(2);
  });

  it("counts whole days, not elapsed hours", () => {
    // 46 calendar days apart, but only 45.4 elapsed days: rounding the raw
    // difference would fall under the threshold and hide the gap entirely.
    const morning = new Date(2026, 7, 6, 9);
    const lateEvening = new Date(2026, 5, 21, 23, 59);
    expect(gapBetween(morning, lateEvening)).toEqual({ unit: "days", amount: 46 });
  });
});

describe("groupClosedLog — gaps attach to the group that follows them", () => {
  it("marks the silence before a group, measured between adjacent tickets", () => {
    const groups = group([ago(2), ago(100)]);
    expect(groups[0].gap).toBeNull(); // nothing precedes the newest group
    expect(groups[1].gap).toEqual({ unit: "months", amount: 3 });
  });

  it("leaves consecutive months unmarked", () => {
    const groups = group([ago(20), ago(50), ago(80)]);
    expect(groups.map((g) => g.gap)).toEqual([null, null, null]);
  });

  it("marks a multi-year silence", () => {
    const groups = group([ago(2), ago(1500)]);
    expect(groups[1].gap).toEqual({ unit: "months", amount: 50 });
  });

  it("measures from the nearest ticket, not from the section boundary", () => {
    // Adding a closure in between shortens the silence: the gap is the distance to
    // the last thing that actually happened, not to where a heading starts.
    const withoutMiddle = group([ago(2), ago(58)]);
    const withMiddle = group([ago(2), ago(9), ago(58)]);
    expect(withoutMiddle.at(-1)!.gap).toEqual({ unit: "days", amount: 56 });
    expect(withMiddle.at(-1)!.gap).toEqual({ unit: "days", amount: 49 });
  });
});

describe("yearsIn", () => {
  it("lists only the years that hold something, newest first", () => {
    const groups = group([ago(2), ago(400), ago(800), ago(830)]);
    expect(yearsIn(groups)).toEqual([2026, 2025, 2024]);
  });

  it("is empty for an empty archive", () => {
    expect(yearsIn(group([]))).toEqual([]);
  });
});
