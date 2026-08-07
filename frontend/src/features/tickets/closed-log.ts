/**
 * Grouping for the closed-ticket log: turn one flat newest-first list into the
 * sections it is read in, and name the silences between them.
 *
 * Pure and framework-free, like `duration.ts` and `sla.ts`, so the awkward cases
 * — a four-year gap, a single ticket, the same month in two different years —
 * are unit-testable without rendering anything.
 *
 * Sections are calendar months. A month is the coarsest unit that still says
 * *when* without making the reader decode it, and every ticket falls in exactly
 * one — which a week-shaped section cannot promise, since a week that straddles
 * two months has to be filed under one of them.
 */

export type ClosedLogItem = { closedAt: string | null };

export type ClosedGroup<T> = {
  /** Stable identity for React keys and for the year jump bar. */
  key: string;
  /** Local year and 0-based month — what the heading formats. */
  year: number;
  month: number;
  items: T[];
  /**
   * How long nothing was closed before this group, when that silence is long
   * enough to be worth drawing. Null when the archive runs straight on.
   */
  gap: Gap | null;
};

/**
 * A stretch with no closures. Reported in months once it passes 60 days, because
 * beyond that "no tickets for 287 days" is a number the reader has to convert.
 */
export type Gap = { unit: "days" | "months"; amount: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Below this a gap is just the weekend, or a quiet fortnight — drawing a marker
 * for it would cry wolf. Above it, the list is hiding something the reader would
 * otherwise scroll straight past.
 */
export const GAP_MIN_DAYS = 45;

/** Past this, a gap is described in months rather than days. */
export const GAP_MONTHS_FROM_DAYS = 60;

/** Local midnight on the day `d` falls in. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Split a newest-first list into consecutive month sections, measuring the
 * silence before each one.
 *
 * The gap is measured between adjacent *tickets* — the oldest of the previous
 * section and the newest of this one — not between section boundaries, because
 * the boundary is a calendar artefact while the tickets are the thing that
 * actually stopped happening.
 *
 * Items with no `closedAt` are dropped rather than bucketed under a guess: the
 * log is keyed on when something closed, and a closure without a time cannot be
 * placed on it. The API only returns closed tickets, so this is defensive.
 */
export function groupClosedLog<T extends ClosedLogItem>(
  items: T[],
): ClosedGroup<T>[] {
  const groups: ClosedGroup<T>[] = [];
  let previousClosedAt: Date | null = null;

  for (const item of items) {
    const ms = item.closedAt ? Date.parse(item.closedAt) : NaN;
    if (Number.isNaN(ms)) continue;
    const closedAt = new Date(ms);
    const key = `${closedAt.getFullYear()}-${closedAt.getMonth()}`;
    const last = groups.at(-1);

    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({
        key,
        year: closedAt.getFullYear(),
        month: closedAt.getMonth(),
        items: [item],
        gap: previousClosedAt ? gapBetween(previousClosedAt, closedAt) : null,
      });
    }
    previousClosedAt = closedAt;
  }

  return groups;
}

/**
 * The silence between two closures, or null when it is short enough to be
 * unremarkable. Measured in whole days, so two closures on consecutive days
 * never read as a gap because of the time of day.
 */
export function gapBetween(newer: Date, older: Date): Gap | null {
  const days = Math.round(
    (startOfDay(newer).getTime() - startOfDay(older).getTime()) / DAY_MS,
  );
  if (days <= GAP_MIN_DAYS) return null;
  if (days <= GAP_MONTHS_FROM_DAYS) return { unit: "days", amount: days };
  // 30-day months: this labels a silence, not an anniversary, and rounding to
  // calendar months would make the same gap read differently across a February.
  return { unit: "months", amount: Math.max(2, Math.round(days / 30)) };
}

/** The years present in a grouped log, newest first — the jump bar's contents. */
export function yearsIn<T>(groups: ClosedGroup<T>[]): number[] {
  const seen = new Set<number>();
  for (const g of groups) seen.add(g.year);
  return [...seen].sort((a, b) => b - a);
}
