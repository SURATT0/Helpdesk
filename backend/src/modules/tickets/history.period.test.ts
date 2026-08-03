import { describe, it, expect } from "vitest";
import { resolvePeriod, type Granularity } from "./history.period";

/**
 * Boundaries are server-local by design (see `history.period.ts`), so these
 * assertions build their expectations with the same local-date constructor
 * rather than with UTC literals — otherwise the suite would pass only in UTC.
 */
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/** Every window is half-open: `start` is in, `end` is the next period's start. */
function expectWindow(
  g: Granularity,
  anchor: Date,
  start: Date,
  end: Date,
): void {
  const p = resolvePeriod(g, anchor);
  expect(p.start.getTime()).toBe(start.getTime());
  expect(p.end.getTime()).toBe(end.getTime());
}

describe("resolvePeriod — week", () => {
  it("starts on Monday for a mid-week anchor", () => {
    // Fri 31 Jul 2026 → week of Mon 27 Jul.
    expectWindow("week", local(2026, 7, 31), local(2026, 7, 27), local(2026, 8, 3));
  });

  it("keeps Sunday in the week that began the preceding Monday", () => {
    // Sun 2 Aug 2026 belongs to the Mon 27 Jul week, not the Mon 3 Aug one.
    expectWindow("week", local(2026, 8, 2), local(2026, 7, 27), local(2026, 8, 3));
  });

  it("treats a Monday anchor as the first day of its own week", () => {
    expectWindow("week", local(2026, 7, 27), local(2026, 7, 27), local(2026, 8, 3));
  });

  it("spans a month boundary without clamping", () => {
    // Mon 29 Jun 2026 → Sun 5 Jul: the window crosses into the next month.
    expectWindow("week", local(2026, 7, 1), local(2026, 6, 29), local(2026, 7, 6));
  });

  it("spans a year boundary", () => {
    // Fri 1 Jan 2027 falls in the week beginning Mon 28 Dec 2026.
    expectWindow("week", local(2027, 1, 1), local(2026, 12, 28), local(2027, 1, 4));
  });

  it("steps a whole week either side", () => {
    const p = resolvePeriod("week", local(2026, 7, 31));
    expect(p.prevAnchor.getTime()).toBe(local(2026, 7, 20).getTime());
    expect(p.nextAnchor.getTime()).toBe(local(2026, 8, 3).getTime());
  });
});

describe("resolvePeriod — month", () => {
  it("covers the calendar month", () => {
    expectWindow("month", local(2026, 7, 31), local(2026, 7, 1), local(2026, 8, 1));
  });

  it("handles a 31-day month rolling into a 30-day one", () => {
    // The bug this guards: `setMonth` on 31 Jul would land in September.
    const p = resolvePeriod("month", local(2026, 7, 31));
    expect(p.nextAnchor.getTime()).toBe(local(2026, 8, 1).getTime());
    expect(resolvePeriod("month", p.nextAnchor).end.getTime()).toBe(
      local(2026, 9, 1).getTime(),
    );
  });

  it("handles February in a leap year", () => {
    expectWindow("month", local(2028, 2, 29), local(2028, 2, 1), local(2028, 3, 1));
  });

  it("steps back across a year boundary", () => {
    const p = resolvePeriod("month", local(2026, 1, 15));
    expect(p.prevAnchor.getTime()).toBe(local(2025, 12, 1).getTime());
  });

  it("steps forward across a year boundary", () => {
    const p = resolvePeriod("month", local(2026, 12, 15));
    expect(p.nextAnchor.getTime()).toBe(local(2027, 1, 1).getTime());
  });
});

describe("resolvePeriod — year", () => {
  it("covers the calendar year", () => {
    expectWindow("year", local(2026, 7, 31), local(2026, 1, 1), local(2027, 1, 1));
  });

  it("steps a whole year either side", () => {
    const p = resolvePeriod("year", local(2026, 7, 31));
    expect(p.prevAnchor.getTime()).toBe(local(2025, 1, 1).getTime());
    expect(p.nextAnchor.getTime()).toBe(local(2027, 1, 1).getTime());
  });
});

describe("isCurrent", () => {
  const now = local(2026, 7, 31);

  it("is true when the window contains now", () => {
    for (const g of ["week", "month", "year"] as const) {
      expect(resolvePeriod(g, now, now).isCurrent).toBe(true);
    }
  });

  it("is false for a past window", () => {
    expect(resolvePeriod("month", local(2026, 6, 15), now).isCurrent).toBe(false);
  });

  it("is false for a future window", () => {
    expect(resolvePeriod("month", local(2026, 8, 15), now).isCurrent).toBe(false);
  });

  it("is true on the closing instant of the period but not on `end`", () => {
    // `end` is exclusive: a `now` exactly at the boundary belongs to the NEXT
    // period, so the July window must report false for it.
    const boundary = local(2026, 8, 1);
    expect(resolvePeriod("month", local(2026, 7, 15), boundary).isCurrent).toBe(
      false,
    );
    expect(resolvePeriod("month", boundary, boundary).isCurrent).toBe(true);
  });
});
