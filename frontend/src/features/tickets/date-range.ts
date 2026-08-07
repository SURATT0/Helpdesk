/**
 * Date-range maths for the closed log's range picker: build the presets, step a
 * range backwards and forwards, and decide what falls inside one.
 *
 * Pure and framework-free for the same reason `closed-log.ts` is: the cases worth
 * getting right — a month that is 28 days long, a step across a year boundary, a
 * range whose ends arrive in the wrong order — are all calendar edges, and they
 * are only testable if no rendering is involved.
 *
 * Everything here works in LOCAL time and at day granularity. `closed_at` is
 * stored UTC, but a person picking "20–26 July" means their own days, and the
 * section headings above the list are already local.
 */

export type DateRange = {
  /** Local midnight on the first day, inclusive. */
  start: Date;
  /** Local midnight on the last day, inclusive — not the exclusive next day. */
  end: Date;
};

export type PresetKey = "last7" | "last30" | "thisMonth" | "thisYear";

/** The presets offered beside the calendar, in the order they are listed. */
export const PRESETS: PresetKey[] = [
  "last7",
  "last30",
  "thisMonth",
  "thisYear",
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days from `a` to `b`, both snapped to midnight first. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Last day of the month `d` falls in — day 0 of the next month. */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** The range a preset means, relative to `today`. */
export function presetRange(preset: PresetKey, today: Date): DateRange {
  const end = startOfDay(today);
  switch (preset) {
    // "Last 7 days" includes today, so it spans today and the six before it —
    // seven days on the calendar, not seven days plus today.
    case "last7":
      return { start: addDays(end, -6), end };
    case "last30":
      return { start: addDays(end, -29), end };
    case "thisMonth":
      return { start: startOfMonth(end), end };
    case "thisYear":
      return { start: new Date(end.getFullYear(), 0, 1), end };
  }
}

/** Which preset a range is exactly, or null when it is a custom span. */
export function matchPreset(range: DateRange, today: Date): PresetKey | null {
  for (const preset of PRESETS) {
    const candidate = presetRange(preset, today);
    if (sameRange(candidate, range)) return preset;
  }
  return null;
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  return (
    startOfDay(a.start).getTime() === startOfDay(b.start).getTime() &&
    startOfDay(a.end).getTime() === startOfDay(b.end).getTime()
  );
}

/**
 * Move a range one whole range earlier or later.
 *
 * A range that is exactly one calendar month or one calendar year steps by month
 * or year, so "this month" walks January → February → March rather than in
 * 31-day jumps that drift off the 1st. Anything else steps by its own length in
 * days, which is what "one period at a time" means for a span someone drew by
 * hand.
 */
export function stepRange(range: DateRange, direction: 1 | -1): DateRange {
  if (isWholeYear(range)) {
    const year = range.start.getFullYear() + direction;
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  }
  if (isWholeMonth(range)) {
    const moved = new Date(
      range.start.getFullYear(),
      range.start.getMonth() + direction,
      1,
    );
    return { start: moved, end: endOfMonth(moved) };
  }
  const length = daysBetween(range.start, range.end) + 1;
  return {
    start: addDays(range.start, direction * length),
    end: addDays(range.end, direction * length),
  };
}

export function isWholeMonth(range: DateRange): boolean {
  return (
    range.start.getDate() === 1 &&
    sameDay(range.end, endOfMonth(range.start)) &&
    range.start.getMonth() === range.end.getMonth() &&
    range.start.getFullYear() === range.end.getFullYear()
  );
}

export function isWholeYear(range: DateRange): boolean {
  return (
    range.start.getMonth() === 0 &&
    range.start.getDate() === 1 &&
    range.end.getMonth() === 11 &&
    range.end.getDate() === 31 &&
    range.start.getFullYear() === range.end.getFullYear()
  );
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/**
 * Put two picked dates in order. A calendar lets you click the later day first,
 * and silently producing an empty range would look like a bug in the data.
 */
export function orderRange(a: Date, b: Date): DateRange {
  return a.getTime() <= b.getTime()
    ? { start: startOfDay(a), end: startOfDay(b) }
    : { start: startOfDay(b), end: startOfDay(a) };
}

/**
 * Does an instant fall inside the range? Compared at day granularity and
 * inclusive at both ends, so a ticket closed at 23:50 on the last day counts —
 * the reader picked that day, not that midnight.
 */
export function rangeContains(range: DateRange, iso: string | null): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const day = startOfDay(new Date(ms)).getTime();
  return (
    day >= startOfDay(range.start).getTime() &&
    day <= startOfDay(range.end).getTime()
  );
}

/**
 * The days to draw for one calendar month, padded to whole weeks starting Monday
 * (ISO, matching how the rest of the app reckons a week). Padding days belong to
 * the neighbouring months and are rendered muted rather than omitted, so the grid
 * keeps its shape.
 */
export function calendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -lead);
  const last = endOfMonth(month);
  const total = lead + last.getDate();
  const weeks = Math.ceil(total / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}
