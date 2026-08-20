"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Paperclip,
} from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { matchesFilters, useSearch } from "../search-context";
import { BulkActionBar } from "./bulk-action-bar";
import { SlaBadge } from "./sla-badge";
import { toneForName } from "../data";
import { compareSla, type SlaAssessment, type SlaState } from "../sla";
import { useAssessSla, useSlaNow } from "../use-sla";
import { useTickets } from "../queries";
import type { Ticket } from "../schemas";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { cn } from "@/lib/utils";

// SLA sits next to Status: the two answer "where is this?" and "how long have I
// got?", and reading them together is the whole job of this table.
// The SLA column is wide enough for the longest label a badge can hold
// ("missed by 9d 20h"); anything narrower and it runs under Priority.
const COLS = "grid-cols-[40px_82px_1fr_128px_152px_100px_140px_130px]";

/** The row's left edge, coloured only when the row needs someone to act. */
const STRIPE: Partial<Record<SlaState, string>> = {
  breached_open: "border-l-sla-breach",
  at_risk: "border-l-sla-risk-line",
};

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-block h-3.5 w-3.5 rounded-[4px]",
        checked ? "bg-brand" : "border-[1.5px] border-[#cbd5e1]",
      )}
    >
      {checked ? (
        <Check
          className="absolute inset-px text-white"
          size={12}
          strokeWidth={3.5}
        />
      ) : null}
    </span>
  );
}

type SortKey =
  | "id"
  | "subject"
  | "status"
  | "priority"
  | "assignee"
  | "category"
  | "slaDue";

type SortState = { key: SortKey; dir: "asc" | "desc" };

// spec status order: new → open → in_progress → pending → resolved → closed
const STATUS_ORDER: Record<Ticket["status"], number> = {
  new: 0,
  open: 1,
  in_progress: 2,
  pending: 3,
  resolved: 4,
  closed: 5,
};

// critical is most severe → lowest rank, so ascending puts Critical first
const PRIORITY_ORDER: Record<Ticket["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// SLA is not here: it is compared on the assessed clock (see `compareSla`),
// not on any field of the row. It used to be re-parsed out of the display
// string, which put every overdue ticket — all of them rendered "0h 0m" — in
// among the ones that still had time.
const COMPARATORS: Record<
  Exclude<SortKey, "slaDue">,
  (a: Ticket, b: Ticket) => number
> = {
  id: (a, b) => a.id - b.id,
  subject: (a, b) => a.subject.localeCompare(b.subject),
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  priority: (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  assignee: (a, b) =>
    (a.assignee ?? "￿").localeCompare(b.assignee ?? "￿"),
  category: (a, b) => a.category.localeCompare(b.category),
};

function SortHeader({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: SortKey;
  sort: SortState | null;
  onSort: (col: SortKey) => void;
}) {
  const active = !!sort && sort.key === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={cn(
        "group flex items-center gap-1 text-left transition-colors hover:text-ink",
        active && "text-ink",
      )}
    >
      {label}
      {sort && sort.key === col ? (
        sort.dir === "asc" ? (
          <ChevronUp size={12} strokeWidth={2.5} />
        ) : (
          <ChevronDown size={12} strokeWidth={2.5} />
        )
      ) : (
        <ChevronsUpDown
          size={12}
          strokeWidth={2}
          // Revealed on hover where there is a cursor, always visible where
          // there is not: on a touch screen the hover state never arrives, so
          // the only hint that these headers sort anything was invisible.
          className="text-[#cbd5e1] opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
        />
      )}
    </button>
  );
}

export function TicketTable() {
  const router = useRouter();
  const { t } = useI18n();
  // Captured here because the row map below shadows `t` with the ticket item.
  const unassignedLabel = t("bulk.unassigned");
  const openRowLabel = (id: number) => t("tickets.openRow", { id });
  const selectRowLabel = (id: number) => t("tickets.selectRow", { id });
  const { query, statuses, priorities, assignees, slaStates } = useSearch();
  const { data, isLoading, isError, refetch } = useTickets();
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  const [sort, setSort] = React.useState<SortState | null>(null);
  const assess = useAssessSla();
  const now = useSlaNow();

  // Judged once per ticket per tick, then reused by the badge, the row stripe
  // and the sort — three readings of the same clock cannot drift apart.
  const slaById = React.useMemo(() => {
    const m = new Map<number, SlaAssessment>();
    for (const x of data?.tickets ?? []) m.set(x.id, assess(x));
    return m;
  }, [data, assess]);

  function onSort(col: SortKey) {
    setSort((prev) =>
      prev && prev.key === col
        ? { key: col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col, dir: "asc" },
    );
  }

  function toggle(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const rows = React.useMemo(() => {
    const filters = { query, statuses, priorities, assignees, slaStates };
    const base = (data?.tickets ?? []).filter((x) =>
      matchesFilters(x, filters, now),
    );
    if (!sort) return base;
    const dir = sort.dir === "asc" ? 1 : -1;
    // Ascending on SLA means worst first: the first click on the header answers
    // "what have I already missed?", which is the reason to sort by it at all.
    const compare =
      sort.key === "slaDue"
        ? (a: Ticket, b: Ticket) =>
            compareSla(slaById.get(a.id) ?? assess(a), slaById.get(b.id) ?? assess(b))
        : COMPARATORS[sort.key];
    return [...base].sort((a, b) => dir * compare(a, b));
  }, [
    data,
    query,
    statuses,
    priorities,
    assignees,
    slaStates,
    sort,
    now,
    slaById,
    assess,
  ]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  return (
    <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-line bg-panel sm:mx-6">
      {/* Columns use fixed widths, so let them scroll horizontally on narrow
          screens instead of squishing. */}
      <TableScroll minWidth={960}>
      {/* header */}
      <div
        className={cn(
          "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
          COLS,
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected}
          aria-label={t("tickets.selectAll")}
          onClick={toggleAll}
          // 40px wide, not the usual 44: the checkbox column is 40px, and a
          // wider box spilled 4px onto the ID sort button beside it, so the far
          // left of that header toggled select-all instead of sorting.
          className="grid w-fit place-items-center rounded-[4px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-10"
        >
          <Checkbox checked={allSelected} />
        </button>
        <SortHeader label={t("col.id")} col="id" sort={sort} onSort={onSort} />
        <SortHeader
          label={t("col.subject")}
          col="subject"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          label={t("col.status")}
          col="status"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          label={t("col.slaDue")}
          col="slaDue"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          label={t("col.priority")}
          col="priority"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          label={t("col.assignee")}
          col="assignee"
          sort={sort}
          onSort={onSort}
        />
        <SortHeader
          label={t("col.category")}
          col="category"
          sort={sort}
          onSort={onSort}
        />
      </div>

      {isLoading ? <LoadingRow /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}
      {!isLoading && !isError && rows.length === 0 ? (
        <EmptyState message={t("tickets.empty")} />
      ) : null}

      {/* rows */}
      {rows.map((t, i) => {
        const isSel = selected.has(t.id);
        const sla = slaById.get(t.id) ?? assess(t);
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={openRowLabel(t.id)}
            onClick={() => router.push(`/tickets/${t.id}`)}
            onKeyDown={(e) => {
              // Only the row itself navigates on Enter/Space — let inner
              // controls (the checkbox) handle their own keys.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/tickets/${t.id}`);
              }
            }}
            className={cn(
              // Every row carries the 3px edge, transparent unless the clock is
              // against it, so nothing shifts sideways as a ticket changes state.
              "grid cursor-pointer items-center border-l-[3px] px-4 py-3 text-[13px]",
              COLS,
              // One colour class, never two: `cn` is a plain join with no
              // tailwind-merge behind it, so a transparent default left in place
              // would race the real colour on stylesheet order and usually win.
              STRIPE[sla.state] ?? "border-l-transparent",
              i < rows.length - 1 && "border-b border-b-[#f1f4f8]",
              isSel ? "bg-[#eff7f2]" : "hover:bg-[#fafbfc]",
            )}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={isSel}
              aria-label={selectRowLabel(t.id)}
              onClick={(e) => toggle(t.id, e)}
              // The visual box stays 14px; only the tappable area grows. A 14px
              // checkbox is not reachable with a finger, which made bulk selection
              // a desktop-only feature by accident. 40px wide to stay inside the
              // column — see the select-all above.
              className="grid w-fit place-items-center rounded-[4px] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-10"
            >
              <Checkbox checked={isSel} />
            </button>
            <span className="font-mono text-[12px] font-medium text-muted">
              #{t.id}
            </span>
            <span className="flex items-center gap-2 truncate pr-3 font-medium text-ink">
              <span className="truncate">{t.subject}</span>
              {t.attachments > 0 ? (
                <span className="flex flex-none items-center gap-1 text-faint">
                  <Paperclip size={12} strokeWidth={2} />
                  <span className="text-[11px]">{t.attachments}</span>
                </span>
              ) : null}
            </span>
            <span>
              <StatusBadge status={t.status} />
            </span>
            <span>
              <SlaBadge sla={sla} />
            </span>
            <PriorityIndicator priority={t.priority} />
            <span className="flex items-center gap-2 text-[12.5px] text-[#475569]">
              {t.assignee ? (
                <>
                  <Avatar
                    name={t.assignee}
                    tone={toneForName(t.assignee)}
                    size={22}
                  />
                  {t.assignee}
                </>
              ) : (
                <span className="italic text-faint">{unassignedLabel}</span>
              )}
            </span>
            <span className="text-[12.5px] text-[#475569]">{t.category}</span>
          </div>
        );
      })}
      </TableScroll>

      {/* bulk bar */}
      {selected.size > 0 && rows.length > 0 ? (
        <BulkActionBar
          selectedIds={[...selected]}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}
