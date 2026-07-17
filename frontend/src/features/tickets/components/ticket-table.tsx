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
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { matchesFilters, useSearch } from "../search-context";
import { BulkActionBar } from "./bulk-action-bar";
import { slaColor, toneForName } from "../data";
import { useTickets } from "../queries";
import type { Ticket } from "../schemas";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[40px_82px_1fr_128px_100px_140px_130px_100px]";

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

/** SLA remaining in minutes for sorting: overdue first, paused/met last. */
function slaMinutes(x: Ticket): number {
  if (x.slaState === "paused" || x.slaState === "met") {
    return Number.POSITIVE_INFINITY;
  }
  const s = x.slaDue.toLowerCase();
  let mins = 0;
  const d = s.match(/(\d+)\s*d/);
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  if (d) mins += Number(d[1]) * 1440;
  if (h) mins += Number(h[1]) * 60;
  if (m) mins += Number(m[1]);
  const overdue =
    s.includes("-") || s.includes("overdue") || s.includes("breach");
  return overdue ? -mins : mins;
}

const COMPARATORS: Record<SortKey, (a: Ticket, b: Ticket) => number> = {
  id: (a, b) => a.id - b.id,
  subject: (a, b) => a.subject.localeCompare(b.subject),
  status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  priority: (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  assignee: (a, b) =>
    (a.assignee ?? "￿").localeCompare(b.assignee ?? "￿"),
  category: (a, b) => a.category.localeCompare(b.category),
  slaDue: (a, b) => slaMinutes(a) - slaMinutes(b),
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
          className="text-[#cbd5e1] opacity-0 transition-opacity group-hover:opacity-100"
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
  const { query, statuses, priorities, assigneeMe } = useSearch();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useTickets();
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  const [sort, setSort] = React.useState<SortState | null>(null);

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
    const filters = { query, statuses, priorities, assigneeMe };
    const base = (data?.tickets ?? []).filter((x) =>
      matchesFilters(x, filters, user?.name ?? null),
    );
    if (!sort) return base;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => dir * COMPARATORS[sort.key](a, b));
  }, [data, query, statuses, priorities, assigneeMe, user, sort]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  return (
    <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-line bg-panel sm:mx-6">
      {/* Columns use fixed widths, so let them scroll horizontally on narrow
          screens instead of squishing. */}
      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
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
          className="inline-flex rounded-[4px]"
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
        <SortHeader
          label={t("col.slaDue")}
          col="slaDue"
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
              "grid cursor-pointer items-center px-4 py-3 text-[13px]",
              COLS,
              i < rows.length - 1 && "border-b border-[#f1f4f8]",
              isSel ? "bg-[#eff7f2]" : "hover:bg-[#fafbfc]",
            )}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={isSel}
              aria-label={selectRowLabel(t.id)}
              onClick={(e) => toggle(t.id, e)}
              className="inline-flex w-fit rounded-[4px]"
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
            <span
              className="font-mono text-[12px] font-medium"
              style={{ color: slaColor[t.slaState] }}
            >
              {t.slaDue}
            </span>
          </div>
        );
      })}
        </div>
      </div>

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
