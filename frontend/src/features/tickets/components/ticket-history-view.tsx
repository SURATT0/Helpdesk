"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Info, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { PRIORITY_META, type Priority } from "@/lib/domain";
import { toneForName } from "../data";
import { formatDuration, openDuration } from "../duration";
import { useClosedHistory, useClosedPeriods } from "../queries";
import type { Granularity, Period, Ticket } from "../schemas";

const PAGE_SIZE = 50;

/**
 * Four columns, down from seven. This log is read two ways — hunting a ticket you
 * half-remember, and scanning what a period contained — and neither needs the
 * priority or the requester of something already closed. Both moved into the
 * filter row above, where they narrow the period instead of repeating per row, and
 * both are on the ticket's own page for when a row turns out to be the one.
 */
const COLS = "grid-cols-[64px_1fr_180px_90px]";

const GRANULARITIES: readonly Granularity[] = ["week", "month", "year"];

const locale = (lang: string) => (lang === "th" ? "th-TH" : "en-US");

/**
 * Label a window from its own bounds rather than from a granularity switch on
 * the client, so the text always describes what the server actually queried.
 * `end` is exclusive, so the week label counts back a day to name its last day.
 *
 * Takes just the three fields it reads, so the same formatter labels the window
 * on screen and every entry in the picker — those cannot drift apart.
 */
function periodLabel(
  period: { granularity: Granularity; start: string; end: string },
  lang: string,
): string {
  const start = new Date(period.start);
  const loc = locale(lang);

  if (period.granularity === "year") {
    return start.toLocaleDateString(loc, { year: "numeric" });
  }
  if (period.granularity === "month") {
    return start.toLocaleDateString(loc, { month: "long", year: "numeric" });
  }

  // `formatRange` elides whatever the two ends share, in the order the locale
  // wants: "Aug 3 – 9, 2026", "Jul 27 – Aug 2, 2026", "Dec 29, 2025 – Jan 4, 2026",
  // and "3–9 ส.ค. 2569" in Thai. Doing it by hand meant choosing which end kept the
  // month, and doing that wrong is what produced "3 – Aug 9, 2026"; Intl also
  // refuses to format a day+year with no month, so this is not a shortcut — it is
  // the only way to get all four shapes right in both locales.
  const lastDay = new Date(Date.parse(period.end) - 86_400_000);
  return new Intl.DateTimeFormat(loc, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatRange(start, lastDay);
}

/** The day a ticket was closed, as a stable key for grouping. */
const dayKey = (iso: string | null) => (iso ? iso.slice(0, 10) : "unknown");

const formatDayHeading = (key: string, lang: string) =>
  key === "unknown"
    ? "—"
    : new Date(`${key}T00:00:00`).toLocaleDateString(locale(lang), {
        weekday: "short",
        day: "numeric",
        month: "short",
      });

/** Rows sharing a closing day, so the day is named once instead of per row. */
function groupByDay(tickets: Ticket[]): { key: string; tickets: Ticket[] }[] {
  const groups: { key: string; tickets: Ticket[] }[] = [];
  for (const ticket of tickets) {
    const key = dayKey(ticket.closedAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.tickets.push(ticket);
    else groups.push({ key, tickets: [ticket] });
  }
  return groups;
}

function Row({ ticket, last }: { ticket: Ticket; last: boolean }) {
  const { t } = useI18n();
  const ms = openDuration(ticket.createdAt, ticket.closedAt);
  const labels = {
    d: t("closedLog.unit.d"),
    h: t("closedLog.unit.h"),
    m: t("closedLog.unit.m"),
  };

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className={cn(
        "grid items-center px-4 py-2.5 text-[13px] hover:bg-app",
        COLS,
        !last && "border-b border-[#f1f4f8]",
      )}
    >
      <span className="font-mono text-[12px] text-faint">#{ticket.id}</span>

      <span className="min-w-0 truncate pr-3 font-medium text-ink">
        {ticket.subject}
      </span>

      {/* The one place an avatar earns its space: a face is faster to scan down a
          column than a name, and this is the only column of people left. */}
      <span className="min-w-0">
        {ticket.assignee ? (
          <span className="flex items-center gap-2">
            <Avatar
              name={ticket.assignee}
              tone={toneForName(ticket.assignee)}
              size={22}
            />
            <span className="truncate text-[12.5px] text-[#475569]">
              {ticket.assignee}
            </span>
          </span>
        ) : (
          <span className="text-[12px] italic text-faint">
            {t("closedLog.unassigned")}
          </span>
        )}
      </span>

      <span className="text-[12px] tabular-nums text-[#475569]">
        {ms == null ? "—" : formatDuration(ms, labels)}
      </span>
    </Link>
  );
}

/**
 * The window on screen, as a button that opens a list of the periods that hold
 * something. The arrows either side step one period at a time; this is how you
 * cross years without clicking twelve times, and it also makes the label
 * discoverable as a control rather than looking like static text.
 *
 * Only populated periods are listed, so every entry leads somewhere — and the
 * list doubles as an answer to "which years do we even have history for", which
 * the stepper alone could only reveal by trial.
 *
 * Button and list are separate components on purpose: the list renders in normal
 * flow BELOW the toolbar and pushes the table down, rather than floating over it.
 * As an overlay it covered the two right-hand columns of the rows behind it.
 */
function PeriodPickerButton({
  label,
  open,
  onToggle,
  disabled,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      // Test id, not a semantic handle: the label is plain text whose shape
      // varies by granularity and locale, so there is nothing stable to match
      // on from the outside.
      data-testid="history-period"
      className="flex min-w-[15ch] items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-semibold text-ink hover:bg-app disabled:opacity-40"
    >
      {label}
      <ChevronDown
        size={13}
        className={cn("text-faint transition-transform", open && "rotate-180")}
      />
    </button>
  );
}

function PeriodPanel({
  granularity,
  current,
  onPick,
  onClose,
}: {
  granularity: Granularity;
  current: Period | undefined;
  onPick: (anchor: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  // Fetched only once opened: the picker is a detour, not the main path.
  const { data, isLoading } = useClosedPeriods(granularity, { enabled: true });
  const periods = data?.data ?? [];

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="listbox"
      aria-label={t("closedLog.pickPeriod")}
      className="mb-3 max-h-[240px] overflow-y-auto rounded-lg border border-line bg-panel p-1"
    >
      {isLoading ? (
        <div className="px-3 py-2 text-[12.5px] text-faint">
          {t("closedLog.loading")}
        </div>
      ) : null}

      {!isLoading && periods.length === 0 ? (
        <div className="px-3 py-2 text-[12.5px] text-faint">
          {t("closedLog.noPeriods")}
        </div>
      ) : null}

      {/* Several across a row rather than one long column: the panel now takes
          vertical space from the table, so it should not take more than it needs. */}
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {periods.map((p) => {
          const selected = current?.start === p.start;
          return (
            <button
              key={p.start}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                // `start` is inside its own period, so it works as the anchor.
                onPick(p.start);
                onClose();
              }}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[12.5px] hover:bg-app",
                selected ? "bg-[#e4f2ea] font-semibold text-brand-hover" : "text-ink",
              )}
            >
              <span className="truncate">
                {periodLabel({ granularity, start: p.start, end: p.end }, lang)}
              </span>
              <span className="flex-none tabular-nums text-[11.5px] text-faint">
                {p.count}
              </span>
            </button>
          );
        })}
      </div>

      {data?.meta.truncated ? (
        <div className="mt-1 border-t border-[#f1f4f8] px-3 py-1.5 text-[11.5px] text-faint">
          {t("closedLog.periodsTruncated", { limit: data.meta.limit })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The closed-ticket history log: one calendar period at a time, stepped with the
 * anchors the server returns. Changing granularity clears the anchor so the view
 * lands on the *current* week/month/year rather than reinterpreting the period
 * being viewed — stepping back three months and switching to "year" should show
 * this year, not the year around that month.
 */
export function TicketHistoryView() {
  const { t, lang } = useI18n();
  const [granularity, setGranularity] = React.useState<Granularity>("month");
  const [anchor, setAnchor] = React.useState<string | undefined>(undefined);
  const [offset, setOffset] = React.useState(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [priority, setPriority] = React.useState<Priority | "">("");
  const [query, setQuery] = React.useState("");

  // Debounced so typing does not fire a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const filter = React.useMemo(
    () => ({
      granularity,
      anchor,
      limit: PAGE_SIZE,
      offset,
      ...(priority ? { priority } : {}),
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
    }),
    [granularity, anchor, offset, priority, debouncedQuery],
  );
  const { data, isLoading, isError, refetch } = useClosedHistory(filter);

  // Memoised because the day grouping below depends on it: `data?.data ?? []`
  // would be a fresh array every render and regroup on each one.
  const tickets = React.useMemo(() => data?.data ?? [], [data]);
  const total = data?.meta.total ?? 0;
  const period = data?.meta.period;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + tickets.length;
  const groups = React.useMemo(() => groupByDay(tickets), [tickets]);

  /** Any period move resets paging — page 3 of July says nothing about June. */
  const goTo = (nextAnchor: string) => {
    setAnchor(nextAnchor);
    setOffset(0);
  };

  /** Narrowing changes what page 1 even means, so paging restarts with it. */
  const narrow = <T,>(set: (v: T) => void) => (value: T) => {
    set(value);
    setOffset(0);
  };

  return (
    <>
      {/* One line. The rest of what this banner used to say — how to use the
          period controls — the controls say themselves, and the visibility rule
          is a footnote, so it moved into the icon's tooltip. */}
      <p className="mb-4 flex items-center gap-2 text-[12.5px] text-[#475569]">
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity */}
          <div className="inline-flex rounded-md border border-line bg-white p-0.5">
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGranularity(g);
                  setAnchor(undefined);
                  setOffset(0);
                  setPickerOpen(false);
                }}
                className={cn(
                  "rounded-[5px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  granularity === g
                    ? "bg-[#e4f2ea] text-brand-hover"
                    : "text-[#475569] hover:bg-app",
                )}
              >
                {t(`closedLog.granularity.${g}`)}
              </button>
            ))}
          </div>

          {/* Search: subject or requester — the two things you remember about a
              ticket you are trying to find again. */}
          <label className="flex w-64 items-center gap-2 rounded-md border border-line bg-white px-2.5 py-[7px] text-[12.5px] focus-within:border-brand">
            <Search size={13} className="flex-none text-faint" />
            <input
              value={query}
              onChange={(e) => narrow(setQuery)(e.target.value)}
              placeholder={t("closedLog.searchPlaceholder")}
              aria-label={t("closedLog.searchPlaceholder")}
              className="w-full bg-transparent text-ink placeholder:text-faint focus:outline-none"
            />
          </label>

          {/* Priority: a filter, not a column. */}
          <select
            value={priority}
            onChange={(e) => narrow(setPriority)(e.target.value as Priority | "")}
            aria-label={t("closedLog.col.priority")}
            className="rounded-md border border-line bg-white px-2.5 py-[7px] text-[12.5px] font-medium text-[#475569]"
          >
            <option value="">{t("closedLog.anyPriority")}</option>
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Period navigator */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => period && goTo(period.prevAnchor)}
            disabled={!period}
            aria-label={t("closedLog.olderPeriod")}
            className="flex items-center rounded-md border border-line bg-white px-2 py-1.5 text-[#475569] hover:bg-app disabled:opacity-40"
          >
            <ChevronLeft size={14} />
          </button>
          <PeriodPickerButton
            label={period ? periodLabel(period, lang) : "—"}
            open={pickerOpen}
            disabled={!period}
            onToggle={() => setPickerOpen((o) => !o)}
          />
          <button
            type="button"
            onClick={() => period && goTo(period.nextAnchor)}
            // No paging into the future: the current period is the newest one
            // that can hold anything.
            disabled={!period || period.isCurrent}
            aria-label={t("closedLog.newerPeriod")}
            className="flex items-center rounded-md border border-line bg-white px-2 py-1.5 text-[#475569] hover:bg-app disabled:opacity-40"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {pickerOpen ? (
        <PeriodPanel
          granularity={granularity}
          current={period}
          onPick={goTo}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <div className="mb-2 text-[12.5px] text-[#475569]">
        {t("closedLog.closedCount", { count: total })}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div
              className={cn(
                "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
                COLS,
              )}
            >
              <span>{t("closedLog.col.id")}</span>
              <span>{t("closedLog.col.subject")}</span>
              <span>{t("closedLog.col.assignee")}</span>
              <span>{t("closedLog.col.duration")}</span>
            </div>

            {isLoading ? <LoadingRow label={t("closedLog.loading")} /> : null}
            {isError ? (
              <ErrorState
                message={t("closedLog.loadError")}
                onRetry={() => refetch()}
              />
            ) : null}
            {!isLoading && !isError && tickets.length === 0 ? (
              <EmptyState message={t("closedLog.empty")} />
            ) : null}

            {groups.map((group, gi) => (
              <div key={group.key}>
                {/* The closing day, named once. This is what replaced the date
                    column: the same information, one line per day instead of one
                    cell per row. */}
                <div className="border-b border-[#f1f4f8] bg-[#fcfdfd] px-4 py-1.5 text-[11.5px] font-semibold text-[#475569]">
                  {formatDayHeading(group.key, lang)}
                </div>
                {group.tickets.map((ticket, i) => (
                  <Row
                    key={ticket.id}
                    ticket={ticket}
                    last={
                      gi === groups.length - 1 && i === group.tickets.length - 1
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between text-[12.5px] text-[#475569]">
          <span>{t("closedLog.range", { from, to, total })}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 font-semibold text-[#475569] hover:bg-app disabled:opacity-40"
            >
              <ChevronLeft size={13} />
              {t("closedLog.prevPage")}
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={to >= total}
              className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 font-semibold text-[#475569] hover:bg-app disabled:opacity-40"
            >
              {t("closedLog.nextPage")}
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
