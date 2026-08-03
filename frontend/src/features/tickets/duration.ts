/**
 * "How long was this ticket open" for the history log, as a compact two-unit
 * string: `2h 10m`, `1d 3h`, `45m`.
 *
 * Pure, and the unit words are injected rather than hardcoded, so the same
 * function serves both locales without importing the dictionary (which would
 * drag React context into a plain formatter).
 */

export type DurationLabels = {
  /** Day suffix — "d" / "ว". */
  d: string;
  /** Hour suffix — "h" / "ชม". */
  h: string;
  /** Minute suffix — "m" / "น". */
  m: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Two units at most: the second is dropped when it would read as zero, so a
 * ticket closed in exactly two hours shows `2h`, not `2h 0m`.
 *
 * Negative input is clamped to zero rather than rendered with a minus sign — it
 * can only come from clock skew between the two stored timestamps, and a
 * "-3m open" cell would read as a bug in the data rather than in the clock.
 */
export function formatDuration(ms: number, labels: DurationLabels): string {
  const total = Math.max(0, ms);

  if (total < MINUTE) return `<1${labels.m}`;

  if (total < HOUR) {
    return `${Math.floor(total / MINUTE)}${labels.m}`;
  }

  if (total < DAY) {
    const hours = Math.floor(total / HOUR);
    const minutes = Math.floor((total % HOUR) / MINUTE);
    return minutes
      ? `${hours}${labels.h} ${minutes}${labels.m}`
      : `${hours}${labels.h}`;
  }

  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  return hours ? `${days}${labels.d} ${hours}${labels.h}` : `${days}${labels.d}`;
}

/**
 * Time from creation to closure. `null` when either end is missing — a row in
 * the closed log always has both, but the DTO types `closedAt` as nullable and
 * inventing a zero would be worse than rendering a dash.
 */
export function openDuration(
  createdAt: string,
  closedAt: string | null,
): number | null {
  if (!closedAt) return null;
  const from = Date.parse(createdAt);
  const to = Date.parse(closedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return to - from;
}
