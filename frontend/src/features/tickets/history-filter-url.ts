/**
 * The closed log's filters, read from and written to the URL's query string.
 *
 * The filters used to live only in component state, so leaving the page threw
 * them away: opening a ticket from a filtered list and pressing Back returned to
 * the whole archive, and a filtered view could not be linked to. Putting them in
 * the URL fixes both at once — the address bar becomes the state.
 *
 * Pure and framework-free, like `date-range.ts` and `closed-log.ts`: the cases
 * worth getting right are all parsing edges — a half-written range, a month of
 * `13`, a priority someone typed by hand — and they are only testable if no
 * rendering is involved.
 *
 * Days are formatted and parsed in LOCAL time, matching `date-range.ts`. Going
 * through `toISOString()` would be a day out for every timezone east of UTC:
 * local midnight on 20 Aug in Bangkok is 19 Aug in UTC, so a shared link would
 * come back a day earlier than the one that was sent.
 */

import { orderRange, startOfDay, type DateRange } from "./date-range";
import { PRIORITIES, type Priority } from "@/lib/domain";

export type HistoryFilters = {
  priority: Priority | "";
  range: DateRange | null;
  query: string;
};

export const EMPTY_FILTERS: HistoryFilters = {
  priority: "",
  range: null,
  query: "",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day as `YYYY-MM-DD`. */
export function formatDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `YYYY-MM-DD` back to local midnight, or null if it is not one.
 *
 * Built from the parts rather than handed to `new Date(string)`, which reads a
 * bare date as UTC. The round-trip check at the end rejects the dates that only
 * look valid — `2026-02-31` would otherwise roll forward into March.
 */
export function parseDay(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return formatDay(date) === value ? date : null;
}

function parsePriority(value: string | null): Priority | "" {
  return value && (PRIORITIES as readonly string[]).includes(value)
    ? (value as Priority)
    : "";
}

/**
 * The filters a query string describes. Anything unparseable is dropped rather
 * than defaulted to something else: a link with a broken `from` should show the
 * whole archive, not a range nobody chose.
 *
 * A range needs both ends — one alone says nothing about the other — and is put
 * back in order, so a hand-edited link with the ends swapped still reads as the
 * span between them instead of showing nothing.
 */
export function readFilters(params: URLSearchParams): HistoryFilters {
  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));
  return {
    priority: parsePriority(params.get("priority")),
    range: from && to ? orderRange(from, to) : null,
    query: (params.get("q") ?? "").trim(),
  };
}

/**
 * The query string for a set of filters, `?` included, or "" when nothing is
 * filtered — so an unfiltered log has a clean `/history` in the address bar.
 *
 * Key order is fixed rather than incidental, so the same filters always produce
 * the same string and the URL does not churn between renders.
 */
export function filtersToSearch(filters: HistoryFilters): string {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  if (query) params.set("q", query);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.range) {
    params.set("from", formatDay(startOfDay(filters.range.start)));
    params.set("to", formatDay(startOfDay(filters.range.end)));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}
