import { describe, expect, it } from "vitest";
import {
  calendarDays,
  daysBetween,
  matchPreset,
  orderRange,
  presetRange,
  rangeContains,
  stepRange,
  type DateRange,
} from "./date-range";

// A Thursday in a 31-day month, with February and a year boundary reachable from
// it — the three things range maths gets wrong.
const TODAY = new Date(2026, 7, 6); // 6 Aug 2026
const d = (y: number, m: number, day: number) => new Date(y, m, day);
const range = (a: Date, b: Date): DateRange => ({ start: a, end: b });
const iso = (date: Date) => date.toISOString();

describe("presets", () => {
  it("counts 'last 7 days' as today plus the six before it", () => {
    // Seven days on the calendar, not seven days and then today as an eighth.
    const r = presetRange("last7", TODAY);
    expect(r).toEqual(range(d(2026, 6, 31), d(2026, 7, 6)));
    expect(daysBetween(r.start, r.end) + 1).toBe(7);
  });

  it("counts 'last 30 days' the same way, across a month boundary", () => {
    const r = presetRange("last30", TODAY);
    expect(r).toEqual(range(d(2026, 6, 8), d(2026, 7, 6)));
    expect(daysBetween(r.start, r.end) + 1).toBe(30);
  });

  it("runs 'this month' from the 1st to today, not to the month end", () => {
    // The rest of the month has not happened; offering it would return nothing.
    expect(presetRange("thisMonth", TODAY)).toEqual(
      range(d(2026, 7, 1), d(2026, 7, 6)),
    );
  });

  it("runs 'this year' from 1 January to today", () => {
    expect(presetRange("thisYear", TODAY)).toEqual(
      range(d(2026, 0, 1), d(2026, 7, 6)),
    );
  });

  it("recognises its own presets, and calls anything else custom", () => {
    expect(matchPreset(presetRange("last7", TODAY), TODAY)).toBe("last7");
    expect(matchPreset(presetRange("thisYear", TODAY), TODAY)).toBe("thisYear");
    // One day either side is no longer the preset.
    expect(
      matchPreset(range(d(2026, 6, 30), d(2026, 7, 6)), TODAY),
    ).toBeNull();
  });
});

describe("stepping", () => {
  it("moves a hand-drawn span by its own length", () => {
    // 20–26 July is 7 days, so back one lands on 13–19 July.
    const week = range(d(2026, 6, 20), d(2026, 6, 26));
    expect(stepRange(week, -1)).toEqual(range(d(2026, 6, 13), d(2026, 6, 19)));
    expect(stepRange(week, 1)).toEqual(range(d(2026, 6, 27), d(2026, 7, 2)));
  });

  it("walks whole months by the calendar, not in 31-day jumps", () => {
    // Stepping March back by 31 days would land on 29 January — the point of
    // treating a whole month as a month is that it stays on the 1st.
    const march = range(d(2026, 2, 1), d(2026, 2, 31));
    expect(stepRange(march, -1)).toEqual(range(d(2026, 1, 1), d(2026, 1, 28)));
    expect(stepRange(march, 1)).toEqual(range(d(2026, 3, 1), d(2026, 3, 30)));
  });

  it("keeps February right in a leap year", () => {
    const march = range(d(2028, 2, 1), d(2028, 2, 31));
    expect(stepRange(march, -1)).toEqual(range(d(2028, 1, 1), d(2028, 1, 29)));
  });

  it("crosses the year boundary in both directions", () => {
    const january = range(d(2026, 0, 1), d(2026, 0, 31));
    expect(stepRange(january, -1)).toEqual(range(d(2025, 11, 1), d(2025, 11, 31)));
    const december = range(d(2026, 11, 1), d(2026, 11, 31));
    expect(stepRange(december, 1)).toEqual(range(d(2027, 0, 1), d(2027, 0, 31)));
  });

  it("walks whole years as years", () => {
    const year = range(d(2026, 0, 1), d(2026, 11, 31));
    expect(stepRange(year, -1)).toEqual(range(d(2025, 0, 1), d(2025, 11, 31)));
  });

  it("returns to where it started after stepping back and forward", () => {
    for (const r of [
      range(d(2026, 6, 20), d(2026, 6, 26)),
      range(d(2026, 2, 1), d(2026, 2, 31)),
      range(d(2026, 0, 1), d(2026, 11, 31)),
    ]) {
      expect(stepRange(stepRange(r, -1), 1)).toEqual(r);
    }
  });

  it("treats a part-month as a span, not as a month", () => {
    // "This month" so far (1st–6th) is not a whole month, so it steps by 6 days
    // rather than jumping to the whole of July.
    const partial = range(d(2026, 7, 1), d(2026, 7, 6));
    expect(stepRange(partial, -1)).toEqual(range(d(2026, 6, 26), d(2026, 6, 31)));
  });
});

describe("picking days", () => {
  it("orders a range however the two days were clicked", () => {
    const later = d(2026, 6, 26);
    const earlier = d(2026, 6, 20);
    expect(orderRange(earlier, later)).toEqual(range(earlier, later));
    // Clicking the end first must not silently produce an empty range.
    expect(orderRange(later, earlier)).toEqual(range(earlier, later));
  });

  it("accepts a single day as a range of one", () => {
    const day = d(2026, 6, 20);
    expect(orderRange(day, day)).toEqual(range(day, day));
  });
});

describe("what falls inside a range", () => {
  const week = range(d(2026, 6, 20), d(2026, 6, 26));

  it("includes both ends, whatever the time of day", () => {
    // Inclusive at day granularity: someone who picked the 26th means all of it,
    // not up to midnight at its start.
    expect(rangeContains(week, iso(new Date(2026, 6, 20, 0, 1)))).toBe(true);
    expect(rangeContains(week, iso(new Date(2026, 6, 26, 23, 59)))).toBe(true);
  });

  it("excludes the days either side", () => {
    expect(rangeContains(week, iso(new Date(2026, 6, 19, 23, 59)))).toBe(false);
    expect(rangeContains(week, iso(new Date(2026, 6, 27, 0, 1)))).toBe(false);
  });

  it("treats a missing or unusable timestamp as outside", () => {
    expect(rangeContains(week, null)).toBe(false);
    expect(rangeContains(week, "not a date")).toBe(false);
  });
});

describe("calendar grid", () => {
  it("pads to whole weeks starting Monday", () => {
    const days = calendarDays(d(2026, 7, 1)); // August 2026 starts on a Saturday
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(1); // Monday
    // The lead-in belongs to July and is kept rather than blanked, so the grid
    // holds its shape.
    expect(days[0]).toEqual(d(2026, 6, 27));
    expect(days.at(-1)!.getDay()).toBe(0); // Sunday
  });

  it("covers every day of the month it is asked for", () => {
    for (const month of [d(2026, 1, 1), d(2028, 1, 1), d(2026, 11, 1)]) {
      const days = calendarDays(month);
      const inMonth = days.filter((x) => x.getMonth() === month.getMonth());
      expect(inMonth.length).toBe(
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
      );
    }
  });
});
