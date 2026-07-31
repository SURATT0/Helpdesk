"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PriorityIndicator } from "@/components/ui/status-badge";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { toneForName } from "../data";
import { formatDuration, openDuration } from "../duration";
import { useClosedHistory } from "../queries";
import type { Granularity, Period, Ticket } from "../schemas";

const PAGE_SIZE = 50;

const COLS = "grid-cols-[64px_1.4fr_110px_150px_150px_130px_90px]";

const GRANULARITIES: readonly Granularity[] = ["week", "month", "year"];

const locale = (lang: string) => (lang === "th" ? "th-TH" : "en-US");

/**
 * Label the window from its own bounds rather than from a granularity switch on
 * the client, so the text always describes what the server actually queried.
 * `end` is exclusive, so the week label counts back a day to name its last day.
 */
function periodLabel(period: Period, lang: string): string {
  const start = new Date(period.start);
  const loc = locale(lang);

  if (period.granularity === "year") {
    return start.toLocaleDateString(loc, { year: "numeric" });
  }
  if (period.granularity === "month") {
    return start.toLocaleDateString(loc, { month: "long", year: "numeric" });
  }

  const lastDay = new Date(Date.parse(period.end) - 86_400_000);
  const sameMonth = start.getMonth() === lastDay.getMonth();
  return `${start.toLocaleDateString(loc, {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
  })} – ${lastDay.toLocaleDateString(loc, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

const formatClosedAt = (iso: string | null, lang: string) =>
  iso
    ? new Date(iso).toLocaleString(locale(lang), {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Row({ ticket, last }: { ticket: Ticket; last: boolean }) {
  const { t, lang } = useI18n();
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

      <PriorityIndicator priority={ticket.priority} />

      <span className="flex min-w-0 items-center gap-2">
        <Avatar
          name={ticket.requester}
          tone={toneForName(ticket.requester)}
          size={22}
        />
        <span className="truncate text-[12.5px] text-[#475569]">
          {ticket.requester}
        </span>
      </span>

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

      <span className="text-[12px] text-[#475569]">
        {formatClosedAt(ticket.closedAt, lang)}
      </span>

      <span className="text-[12px] tabular-nums text-[#475569]">
        {ms == null ? "—" : formatDuration(ms, labels)}
      </span>
    </Link>
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

  const filter = React.useMemo(
    () => ({ granularity, anchor, limit: PAGE_SIZE, offset }),
    [granularity, anchor, offset],
  );
  const { data, isLoading, isError, refetch } = useClosedHistory(filter);

  const tickets = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const period = data?.meta.period;
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + tickets.length;

  /** Any period move resets paging — page 3 of July says nothing about June. */
  const goTo = (nextAnchor: string) => {
    setAnchor(nextAnchor);
    setOffset(0);
  };

  return (
    <>
      <p className="mb-4 flex max-w-[78ch] items-start gap-2 text-[12.5px] leading-relaxed text-[#475569]">
        <Info size={14} className="mt-[2px] flex-none text-faint" />
        {t("closedLog.explainer")}
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
          <span className="min-w-[13ch] text-center text-[13px] font-semibold text-ink">
            {period ? periodLabel(period, lang) : "—"}
          </span>
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

      <div className="mb-2 text-[12.5px] text-[#475569]">
        {t("closedLog.closedCount", { count: total })}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div
              className={cn(
                "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
                COLS,
              )}
            >
              <span>{t("closedLog.col.id")}</span>
              <span>{t("closedLog.col.subject")}</span>
              <span>{t("closedLog.col.priority")}</span>
              <span>{t("closedLog.col.requester")}</span>
              <span>{t("closedLog.col.assignee")}</span>
              <span>{t("closedLog.col.closedAt")}</span>
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

            {tickets.map((ticket, i) => (
              <Row
                key={ticket.id}
                ticket={ticket}
                last={i === tickets.length - 1}
              />
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
