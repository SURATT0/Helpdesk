"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Info, Search, SlidersHorizontal, X } from "lucide-react";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { PRIORITIES, type Priority } from "@/lib/domain";
import {
  groupClosedLog,
  yearsIn,
  type ClosedGroup,
  type Gap,
} from "../closed-log";
import { rangeContains, type DateRange } from "../date-range";
import { filtersToSearch, readFilters } from "../history-filter-url";
import { DateRangePicker, formatRangeLabel } from "./date-range-picker";
import { useClosedLog, useClosedTotal } from "../queries";
import type { Ticket } from "../schemas";

const locale = (lang: string) => (lang === "th" ? "th-TH" : "en-US");

/** Priority as a dot only. The word is there for screen readers; the colour scans. */
const DOT: Record<Priority, string> = {
  critical: "bg-priority-critical",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

/**
 * The closing day on a row: day and month, no year. The section heading above
 * already carries the year, and repeating it per row is what made the old table
 * give the date a column of its own.
 */
function formatClosedAt(iso: string | null, lang: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale(lang), {
    day: "numeric",
    month: "short",
  }).format(d);
}

function Row({ ticket, lang }: { ticket: Ticket; lang: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      // `relative` is load-bearing, not decoration: the screen-reader label
      // below is `sr-only`, which is `position: absolute`. Without a positioned
      // ancestor it resolves against the initial containing block instead — so
      // it escapes this page's scroll container *and* the shell's
      // `overflow-hidden`, and every row adds its own offset to the document's
      // height. One archive-length page then scrolls behind the viewport,
      // carrying the sticky search bar, the year bar and the sidebar off-screen
      // with it.
      className="relative flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-app sm:gap-3 sm:px-4"
    >
      <span className={cn("h-2 w-2 flex-none rounded-full", DOT[ticket.priority])} />
      <span className="sr-only">{t(`priority.${ticket.priority}`)}</span>
      <span className="min-w-0 flex-1 truncate text-control font-medium text-ink">
        {ticket.subject}
      </span>
      <span className="flex-none whitespace-nowrap text-caption text-faint">
        #{ticket.id} · {formatClosedAt(ticket.closedAt, lang)}
      </span>
    </Link>
  );
}

/**
 * A stretch with nothing in it, drawn rather than left as an unexplained jump
 * between two headings. This is what makes the log read as a timeline instead of
 * a list of unrelated months: two sections can sit next to each other and be
 * nine months apart, and nothing but this says so.
 */
function GapMarker({ gap }: { gap: Gap }) {
  const { t } = useI18n();
  const key =
    gap.unit === "months"
      ? gap.amount === 1
        ? "closedLog.gap.month"
        : "closedLog.gap.months"
      : gap.amount === 1
        ? "closedLog.gap.day"
        : "closedLog.gap.days";
  return (
    <div className="flex items-center gap-3 bg-app px-3 py-2 sm:px-4">
      <span className="h-px flex-1 bg-line" />
      <span className="text-meta font-medium tracking-columns text-faint">
        {t(key, { n: gap.amount })}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * A year as the section headings write it. Thai renders dates in the Buddhist era,
 * so a raw `2026` in the jump bar would disagree with the "กรกฎาคม 2569" heading it
 * scrolls to. Taken from `formatToParts` because asking Intl for a year on its own
 * yields "พ.ศ. 2569" — the era prefix is more than a chip can hold.
 */
function formatYear(year: number, lang: string): string {
  const parts = new Intl.DateTimeFormat(locale(lang), {
    year: "numeric",
  }).formatToParts(new Date(year, 0, 1));
  return parts.find((p) => p.type === "year")?.value ?? String(year);
}

/** The month a section covers — never a date range for the reader to decode. */
function useHeading() {
  const { lang } = useI18n();
  return React.useCallback(
    (group: ClosedGroup<Ticket>) =>
      new Intl.DateTimeFormat(locale(lang), {
        month: "long",
        year: "numeric",
      }).format(new Date(group.year, group.month, 1)),
    [lang],
  );
}

/**
 * What is left of the filter row, folded into one button. A dropdown beside the
 * button on a wide screen; a sheet from the bottom edge on a narrow one, where a
 * menu anchored to a wrapped toolbar would open off-screen.
 */
function FiltersButton({
  priority,
  onPick,
}: {
  priority: Priority | "";
  onPick: (p: Priority | "") => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const active = priority ? 1 : 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex flex-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-body font-medium",
          active
            ? "border-brand bg-accent-soft text-brand-hover"
            : "border-line bg-panel text-muted hover:bg-app",
        )}
      >
        <SlidersHorizontal size={13} />
        {active
          ? t("closedLog.filtersCount", { n: active })
          : t("closedLog.filters")}
      </button>

      {open ? (
        <>
          {/* A tap anywhere closes it. Dimmed only on small screens, where the
              panel is a sheet over the list rather than a menu beside a button. */}
          <div
            className="fixed inset-0 z-30 bg-ink/20 sm:bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={t("closedLog.filters")}
            className="fixed inset-x-0 bottom-0 z-40 rounded-t-lg border border-line bg-panel p-4 shadow-modal sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-lg sm:p-1.5 sm:shadow-card"
          >
            <div className="mb-2 flex items-center justify-between sm:hidden">
              <span className="text-control font-semibold text-ink">
                {t("closedLog.filters")}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("closedLog.closeFilters")}
                className="text-muted"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mb-1 px-1 text-meta font-semibold tracking-columns text-faint">
              {t("closedLog.col.priority")}
            </div>
            {(["", ...PRIORITIES] as (Priority | "")[]).map((value) => {
              const selected = value === priority;
              return (
                <button
                  key={value || "any"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onPick(value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-body sm:py-1.5",
                    selected
                      ? "bg-accent-soft font-semibold text-brand-hover"
                      : "text-ink hover:bg-app",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 flex-none rounded-full",
                      value ? DOT[value] : "",
                    )}
                  />
                  {value ? t(`priority.${value}`) : t("closedLog.anyPriority")}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function TicketHistoryView() {
  const { t, lang } = useI18n();
  const heading = useHeading();
  /**
   * The filters start from the URL, and are read from it exactly once.
   *
   * Once mounted the state below owns them and writes back — re-reading on every
   * change would fight the reader mid-keystroke, and the address bar is only an
   * entry point, not a second source of truth.
   */
  const searchParams = useSearchParams();
  const [initial] = React.useState(() => readFilters(searchParams));
  const [priority, setPriority] = React.useState<Priority | "">(
    initial.priority,
  );
  const [range, setRange] = React.useState<DateRange | null>(initial.range);
  const [query, setQuery] = React.useState(initial.query);
  const [debouncedQuery, setDebouncedQuery] = React.useState(initial.query);

  /**
   * Today, fixed for the life of the view. The presets are relative to it, and a
   * "last 7 days" that quietly re-anchored at midnight would move the list under
   * a reader who had not touched anything.
   */
  const today = React.useMemo(() => new Date(), []);

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  /**
   * Mirror the filters into the address bar, so leaving the page and coming back
   * — Back out of a ticket, most of all — returns to the list that was being
   * read rather than to the whole archive, and so a filtered view can be linked
   * to.
   *
   * `replaceState`, not `router.replace`: this relabels the entry the reader is
   * already on instead of routing. A push would stack one history entry per
   * filter change, turning Back into an undo of the last dozen keystrokes before
   * it ever left the page; `router.replace` avoids that but still re-runs the
   * route for a change only this component cares about.
   *
   * Keyed on the *debounced* query for the same reason the fetch is: typing
   * "vpn" should leave one URL behind, not three.
   */
  React.useEffect(() => {
    const next = `${window.location.pathname}${filtersToSearch({
      priority,
      range,
      query: debouncedQuery,
    })}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [priority, range, debouncedQuery]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useClosedLog({
    ...(priority ? { priority } : {}),
    ...(debouncedQuery ? { q: debouncedQuery } : {}),
  });
  // How big the archive is regardless of the filters — the number the search
  // box quotes, which must not shrink as you type into it.
  const { data: archiveTotal } = useClosedTotal();

  const loaded = React.useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.data),
    [data],
  );

  /**
   * The date range narrows what has already been fetched rather than being sent
   * to the server: the log reads the whole archive in one query, so a span inside
   * it is a question the client can already answer, and the ticket query stays
   * exactly as it was.
   *
   * That only holds while everything is loaded, so an active range pulls the
   * remaining pages in below. Filtering a partly-loaded list would silently drop
   * closures from the far end of the archive — the very thing a date filter is
   * used to go looking for.
   */
  const tickets = React.useMemo(
    () =>
      range ? loaded.filter((x) => rangeContains(range, x.closedAt)) : loaded,
    [loaded, range],
  );
  React.useEffect(() => {
    if (range && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [range, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const groups = React.useMemo(() => groupClosedLog(tickets), [tickets]);
  const years = React.useMemo(() => yearsIn(groups), [groups]);
  /** The first section of each year — where the year bar jumps to. */
  const anchorKeys = React.useMemo(() => {
    const first = new Map<number, string>();
    for (const g of groups) if (!first.has(g.year)) first.set(g.year, g.key);
    return first;
  }, [groups]);

  /**
   * Where a section heading must stop so it lands just under the search bar
   * rather than behind it.
   *
   * Measured, not hardcoded: the bar's controls wrap onto a second line at 320px.
   * Measured against the scrollport's PADDING box, because that is what a sticky
   * offset resolves against — measuring from the border box instead parks every
   * heading one page-padding too low, leaving a strip between the bar and the
   * heading for rows to scroll through.
   */
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const [stickyTop, setStickyTop] = React.useState(0);
  React.useEffect(() => {
    const el = barRef.current;
    const scroller = el?.closest("main");
    if (!el || !scroller) return;
    const measure = () => {
      const padding = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const scrollportTop = scroller.getBoundingClientRect().top + padding;
      setStickyTop(
        Math.round(el.getBoundingClientRect().bottom - scrollportTop),
      );
    };
    measure();
    // Fires on width changes too, which is what catches the padding stepping up
    // at the `sm` breakpoint.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * Which year the reader is currently inside, for the jump bar: the last section
   * whose heading has reached the line the headings pin to.
   *
   * Read straight off the DOM in section order rather than through an
   * IntersectionObserver: an observer is only told about headings whose visibility
   * *changed*, so scrolling fast enough for one to cross the band between two
   * callbacks leaves the highlight on the previous year — which is exactly what it
   * did on a four-year archive where whole years are one row tall.
   */
  const [activeYear, setActiveYear] = React.useState<number | null>(null);
  React.useEffect(() => {
    const scroller = barRef.current?.closest("main");
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = scroller.getBoundingClientRect().top + stickyTop + 8;
      let current: number | null = null;
      for (const group of groups) {
        const el = document.getElementById(`closed-section-${group.key}`);
        if (el && el.getBoundingClientRect().top <= line) current = group.year;
      }
      // At the end of the list, the oldest year is the one being read even though
      // its heading never reaches the line — a short archive bottoms out first.
      // Without this, clicking the oldest year in the bar scrolls there and leaves
      // the bar highlighting a different one.
      const atBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) current = groups.at(-1)?.year ?? current;
      setActiveYear(current ?? groups[0]?.year ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [groups, stickyTop]);

  // Load the next page when the end comes into view. An archive that fits in one
  // page never triggers this — the list simply arrives whole.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const jumpTo = (year: number) => {
    const key = anchorKeys.get(year);
    if (!key) return;
    document
      .getElementById(`closed-section-${key}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const filtering = debouncedQuery.length > 0 || priority !== "" || range != null;
  const clearAll = () => {
    setQuery("");
    setDebouncedQuery("");
    setPriority("");
    setRange(null);
  };
  const searchLabel = t("closedLog.searchAll", { n: archiveTotal ?? 0 });

  return (
    <>
      {/* Search first, and wide: finding one ticket again is what this page is
          for. What used to sit above it — two overlapping period navigators and a
          granularity switch — was in the way of that, and made choosing a window
          the price of admission. */}
      <div
        ref={barRef}
        // Spans the page's horizontal padding so nothing shows down either side,
        // and owns the top padding itself — see this page's `<main>` for why that
        // padding cannot live there.
        className="sticky top-0 z-20 -mx-4 bg-app px-4 pb-3 pt-4 sm:-mx-6 sm:px-6 sm:pt-6"
      >
        <label className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 focus-within:border-brand">
          <Search size={14} className="flex-none text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            className={cn(
              "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
              FIELD_TEXT_13,
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              // Named apart from the empty state's "Clear search" button: two
              // controls with one name is ambiguous read aloud, and this one only
              // empties the box while that one also drops the filters.
              aria-label={t("closedLog.clearSearchField")}
              className="flex-none text-faint hover:text-muted"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} today={today} />
          <FiltersButton priority={priority} onPick={setPriority} />
          {years.length > 1 ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
              role="group"
              aria-label={t("closedLog.jumpToYear")}
            >
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => jumpTo(y)}
                  aria-current={activeYear === y}
                  className={cn(
                    "flex-none rounded-md px-2 py-1 text-dense font-semibold",
                    activeYear === y
                      ? "bg-accent-soft text-brand-hover"
                      : "text-faint hover:bg-panel hover:text-muted",
                  )}
                >
                  {formatYear(y, lang)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <p className="mb-3 flex items-center gap-2 text-dense text-muted">
        {t("closedLog.explainer")}
        <span
          title={t("closedLog.scopeNote")}
          aria-label={t("closedLog.scopeNote")}
          tabIndex={0}
          className="inline-flex cursor-help text-faint hover:text-muted"
        >
          <Info size={13} />
        </span>
      </p>

      {/* No `overflow-hidden` here, deliberately: it would make this card the
          nearest scroll container, and the sticky section headings would then
          stick to the card — pinned inside it, covering the first rows — instead
          of to the page. The headings are the same colour as the card, so nothing
          needs clipping anyway. */}
      <div className="rounded-lg border border-line bg-panel">
        {isLoading ? <LoadingRow label={t("closedLog.loading")} /> : null}
        {isError ? (
          <ErrorState
            message={t("closedLog.loadError")}
            onRetry={() => refetch()}
          />
        ) : null}

        {!isLoading && !isError && tickets.length === 0 ? (
          <div className="px-4 py-10 text-center">
            {debouncedQuery ? (
              <>
                <p className="text-control text-muted">
                  {t("closedLog.noMatch", { q: debouncedQuery })}
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-3 rounded-md border border-line px-3 py-1.5 text-body font-semibold text-brand hover:bg-app"
                >
                  {t("closedLog.clearSearch")}
                </button>
              </>
            ) : range ? (
              <>
                <p className="text-control text-muted">
                  {t("closedLog.noMatchRange", {
                    range: formatRangeLabel(range, lang),
                  })}
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-3 rounded-md border border-line px-3 py-1.5 text-body font-semibold text-brand hover:bg-app"
                >
                  {t("closedLog.clearFilters")}
                </button>
              </>
            ) : priority ? (
              <>
                <p className="text-control text-muted">
                  {t("closedLog.noMatchFilter")}
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-3 rounded-md border border-line px-3 py-1.5 text-body font-semibold text-brand hover:bg-app"
                >
                  {t("closedLog.clearFilters")}
                </button>
              </>
            ) : (
              // Nothing has ever been closed: a statement, not a call to action.
              // There is nothing the reader could do from here anyway.
              <p className="text-control text-muted">
                {t("closedLog.emptyArchive")}
              </p>
            )}
          </div>
        ) : null}

        {groups.map((group) => (
          <div key={group.key}>
            {group.gap ? <GapMarker gap={group.gap} /> : null}
            <div
              id={`closed-section-${group.key}`}
              style={{ top: stickyTop, scrollMarginTop: stickyTop + 8 }}
              className="sticky z-10 flex items-center justify-between border-y border-line bg-panel px-3 py-2 sm:px-4"
            >
              <span className="text-dense font-semibold text-ink">
                {heading(group)}
              </span>
              <span
                className="text-caption font-medium text-faint"
                aria-label={t("closedLog.groupCount", { n: group.items.length })}
              >
                {group.items.length}
              </span>
            </div>
            {group.items.map((ticket) => (
              <Row key={ticket.id} ticket={ticket} lang={lang} />
            ))}
          </div>
        ))}

        <div ref={sentinelRef} />
        {isFetchingNextPage ? (
          <LoadingRow label={t("closedLog.loadingMore")} />
        ) : null}
      </div>

      {filtering && tickets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-dense text-muted">
          {/* With a range on, the server's total counts the whole archive — the
              narrowing happened here, so the count has to come from here too. */}
          <span>
            {t("closedLog.matches", {
              n: range ? tickets.length : (data?.pages[0]?.meta.total ?? 0),
            })}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="font-semibold text-brand hover:underline"
          >
            {t("closedLog.clearFilters")}
          </button>
        </div>
      ) : null}
    </>
  );
}
