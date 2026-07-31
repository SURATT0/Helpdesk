/**
 * Period maths for the closed-ticket history log: turn a granularity plus any
 * date inside the period into the half-open window `[start, end)` to filter on,
 * and the anchors either side for the prev/next navigation.
 *
 * Pure and framework-free so the boundary cases (month lengths, leap years, a
 * week straddling two months or two years) are unit-testable — same reason
 * `sla.ts` is a separate module.
 *
 * **Boundaries are server-local**, matching the daily trend buckets in the
 * reports module: a "month" is the calendar month as the server reckons it, not
 * a UTC month. `closedAt` is stored UTC and compared against these local
 * instants, so a deployment that moves timezone re-slices old periods — the same
 * tradeoff reports already makes, kept deliberately consistent rather than
 * introducing a second, conflicting notion of "this month".
 *
 * Weeks start **Monday** (ISO 8601), not Sunday.
 */

export type Granularity = "week" | "month" | "year";

export type Period = {
  granularity: Granularity;
  /** Inclusive lower bound. */
  start: Date;
  /** Exclusive upper bound — the first instant of the next period. */
  end: Date;
  /** A date inside the previous period, for the "older" button. */
  prevAnchor: Date;
  /** A date inside the next period, for the "newer" button. */
  nextAnchor: Date;
  /**
   * Does this period contain `now`? The UI disables "newer" on the current
   * period rather than letting the user page into empty future windows.
   */
  isCurrent: boolean;
};

/** Local midnight on the day `d` falls in. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Local midnight on the Monday of `d`'s week. `getDay()` is 0=Sunday, so the
 * `+ 6) % 7` shift makes Monday the zero point.
 */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/**
 * Resolve the window to query.
 *
 * `anchor` is any instant inside the wanted period — the client passes back the
 * `prevAnchor`/`nextAnchor` it was given, so it never has to know how long a
 * month is. Date arithmetic goes through the `new Date(y, m, d)` constructor
 * rather than `setMonth`, which would turn 31 Jan into 3 Mar on a short month.
 */
export function resolvePeriod(
  granularity: Granularity,
  anchor: Date,
  now: Date = new Date(),
): Period {
  let start: Date;
  let end: Date;
  let prevAnchor: Date;
  let nextAnchor: Date;

  if (granularity === "week") {
    start = startOfWeek(anchor);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    prevAnchor = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() - 7,
    );
    nextAnchor = end;
  } else if (granularity === "month") {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    prevAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    nextAnchor = end;
  } else {
    start = new Date(anchor.getFullYear(), 0, 1);
    end = new Date(anchor.getFullYear() + 1, 0, 1);
    prevAnchor = new Date(anchor.getFullYear() - 1, 0, 1);
    nextAnchor = end;
  }

  return {
    granularity,
    start,
    end,
    prevAnchor,
    nextAnchor,
    isCurrent: now >= start && now < end,
  };
}
