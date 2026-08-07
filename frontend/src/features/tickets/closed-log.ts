/**
 * Grouping for the closed-ticket log: turn one flat newest-first list into the
 * sections it is read in, and name the silences between them.
 *
 * Pure and framework-free, like `duration.ts` and `sla.ts`, so the awkward cases
 * — a week that straddles two months, a four-year gap, a single ticket — are
 * unit-testable without rendering anything.
 *
 * The headings deliberately do NOT use a date range. "Jul 27 – Aug 2, 2026" makes
 * the reader work out which week that is; "This week" does not.
 */

export type ClosedLogItem = { closedAt: string | null };

/** Which heading a group gets, and therefore how it is worded. */
export type GroupKind = "this_week" | "last_week" | "month";

export type ClosedGroup<T> = {
  /** Stable identity for React keys and for the year jump bar. */
  key: string;
  kind: GroupKind;
  /** Local year and 0-based month — what a "month" heading formats. */
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

/** Monday of the ISO week `d` falls in — weeks start Monday, as the server reckons them. */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  // getDay(): 0 = Sunday, so Sunday counts back 6 days rather than 0.
  const back = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
}

/**
 * Which section a closure belongs to, relative to `now`.
 *
 * "This week" is the current ISO week, not a rolling 7 days: a Monday morning
 * would otherwise be filed under a heading that also covers last Wednesday, and
 * "this week" would silently mean something different every day.
 */
function kindFor(closedAt: Date, now: Date): GroupKind {
  const thisWeek = startOfWeek(now);
  if (closedAt.getTime() >= thisWeek.getTime()) return "this_week";
  const lastWeek = new Date(
    thisWeek.getFullYear(),
    thisWeek.getMonth(),
    thisWeek.getDate() - 7,
  );
  if (closedAt.getTime() >= lastWeek.getTime()) return "last_week";
  return "month";
}

function groupKey(kind: GroupKind, d: Date): string {
  if (kind === "month") return `${d.getFullYear()}-${d.getMonth()}`;
  return kind;
}

/**
 * Split a newest-first list into consecutive sections, measuring the silence
 * before each one.
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
  now: Date = new Date(),
): ClosedGroup<T>[] {
  const groups: ClosedGroup<T>[] = [];
  let previousClosedAt: Date | null = null;

  for (const item of items) {
    const ms = item.closedAt ? Date.parse(item.closedAt) : NaN;
    if (Number.isNaN(ms)) continue;
    const closedAt = new Date(ms);
    const kind = kindFor(closedAt, now);
    const key = groupKey(kind, closedAt);
    const last = groups.at(-1);

    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({
        key,
        kind,
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
 * unremarkable. `newer` and `older` are whole days apart at day granularity, so
 * two closures on consecutive days never read as a gap.
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
