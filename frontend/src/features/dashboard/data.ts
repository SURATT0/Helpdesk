import { PRIORITY_META, type DisplayStatus, type Priority } from "@/lib/domain";
import { DISPLAY_STATUSES, STATUS_META } from "@/lib/ticket-status";

/**
 * Chart colours, taken from the badge palettes rather than chosen again here.
 *
 * They used to be a second set of hand-picked hex, and all five had drifted: a
 * Pending ticket was #6d28d9 in its badge and #8b5cf6 in the bar beside it, a
 * Closed one #475569 and #cbd5e1. Same screen, same status, two colours — which
 * is exactly the thing a legend is supposed to rule out. A chart is a second
 * rendering of the badge, so it reads the badge's colour.
 *
 * `fg` is the right half of the pair: `bg` is the pale wash a badge sits on and
 * disappears against the card, while `fg` is the weight the text is drawn in.
 */
export const STATUS_CHART: Record<DisplayStatus, { color: string }> =
  Object.fromEntries(
    DISPLAY_STATUSES.map((s) => [s, { color: STATUS_META[s].fg }]),
  ) as Record<DisplayStatus, { color: string }>;

/** Donut colours for "Open by priority" — the dot colour off PRIORITY_META. */
export const PRIORITY_CHART: Record<Priority, { color: string }> =
  Object.fromEntries(
    (Object.keys(PRIORITY_META) as Priority[]).map((p) => [
      p,
      { color: PRIORITY_META[p].dot },
    ]),
  ) as Record<Priority, { color: string }>;

/** Build a conic-gradient string from ordered {value,color} slices. */
export function conicGradient(slices: { value: number; color: string }[]): string {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const stops = slices.map((s) => {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    return `${s.color} ${start}% ${end}%`;
  });
  return `conic-gradient(${stops.join(",")})`;
}
