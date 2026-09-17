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
import { needsOwnDescription } from "@/lib/category-other";
import { compareText, compareTextLast } from "@/lib/collation";
import { hasPermission } from "@/lib/permissions";
import { useAuth } from "@/features/auth/context";
import { useCustomers } from "@/features/customers/queries";
import { matchesFilters, useSearch } from "../search-context";
import { BulkActionBar } from "./bulk-action-bar";
import { SlaBadge } from "./sla-badge";
import { toneForName } from "../data";
import { compareSla, type SlaAssessment, type SlaState } from "../sla";
import { useAssessSla, useSlaNow } from "../use-sla";
import { useTickets } from "../queries";
import type { Ticket } from "../schemas";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { PRIORITIES } from "@/lib/domain";
import { DISPLAY_STATUSES } from "@/lib/ticket-status";
import { cn } from "@/lib/utils";

// SLA sits next to Status: the two answer "where is this?" and "how long have I
// got?", and reading them together is the whole job of this table.
// The SLA column is wide enough for the longest label a badge can hold
// ("missed by 9d 20h"); anything narrower and it runs under Priority.
const COLS = "grid-cols-[40px_82px_1fr_128px_152px_100px_140px_130px]";
/**
 * The same table without its 40px select column, for a viewer who cannot work
 * tickets — see `canSelect` below. The four variants are spelled out rather than
 * assembled, because Tailwind only emits an arbitrary value it can SEE in the
 * source: a template string built at runtime produces a class name that exists
 * in the DOM and in no stylesheet, and the table silently loses its grid.
 */
const COLS_NO_SELECT = "grid-cols-[82px_1fr_128px_152px_100px_140px_130px]";
/**
 * With the tenant column. Only ever used by a viewer who reaches more than one
 * customer — for anyone else it would hold the same name on every row, and a
 * constant column costs 130px on a table that already scrolls sideways.
 */
const COLS_WITH_CUSTOMER =
  "grid-cols-[40px_82px_1fr_128px_152px_100px_140px_130px_130px]";
const COLS_NO_SELECT_WITH_CUSTOMER =
  "grid-cols-[82px_1fr_128px_152px_100px_140px_130px_130px]";

/** The row's left edge, coloured only when the row needs someone to act. */
const STRIPE: Partial<Record<SlaState, string>> = {
  breached_open: "border-l-sla-breach",
  at_risk: "border-l-sla-risk-line",
};

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-block h-3.5 w-3.5 rounded",
        checked ? "bg-brand" : "border-[1.5px] border-dim",
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

// Sorting agrees with the badges because it reads the same ordered lists they
// do: DISPLAY_STATUSES is already New → In Progress → Pending → Closed, and
// PRIORITIES is already most-severe-first, so ascending puts Critical on top.
// Both were a fourth hand-written copy of an order that exists once.
const rank = <T extends string>(order: readonly T[]) =>
  Object.fromEntries(order.map((v, i) => [v, i])) as Record<T, number>;

const STATUS_ORDER = rank(DISPLAY_STATUSES);
const PRIORITY_ORDER = rank(PRIORITIES);

// SLA is not here: it is compared on the assessed clock (see `compareSla`),
// not on any field of the row. It used to be re-parsed out of the display
// string, which put every overdue ticket — all of them rendered "0h 0m" — in
// among the ones that still had time.
const COMPARATORS: Record<
  Exclude<SortKey, "slaDue">,
  (a: Ticket, b: Ticket) => number
> = {
  id: (a, b) => a.id - b.id,
  // `compareText`, not `localeCompare`. The latter builds a fresh collator on
  // every comparison — n log n of them for one sort — and asks the BROWSER's
  // locale, so this table came out Thai-first for a reader whose machine was set
  // to Thai and English-first for one whose was not, matching neither each other
  // nor the order the server sends everything else in.
  subject: (a, b) => compareText(a.subject, b.subject),
  status: (a, b) =>
    STATUS_ORDER[a.displayStatus] - STATUS_ORDER[b.displayStatus],
  priority: (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  // Unassigned last, and said so rather than arranged. It used to substitute
  // U+FFFF for the missing name — a character picked to sort after everything,
  // which works right up until a name contains one, and reads as a typo either
  // way. See `compareTextLast`.
  assignee: (a, b) => compareTextLast(a.assignee, b.assignee),
  category: (a, b) => compareText(a.category, b.category),
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
          className="text-dim opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
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
  const {
    query,
    statuses,
    priorities,
    assignees,
    customers: selectedCustomers,
    slaStates,
    activeCount,
  } = useSearch();
  const { data, isLoading, isError, refetch } = useTickets();
  const { user } = useAuth();
  /**
   * Show the tenant column only when it can say something.
   *
   * Two conditions, and both are needed. The ROLE, because a requester has no
   * business reading the desk's tenant structure. And reach, because with one
   * customer every row carries the same name — a column that is constant is not
   * information, and it costs 130px on a table that already scrolls sideways on
   * a phone.
   */
  const staff = user != null && user.role !== "user";
  const { data: customers = [] } = useCustomers({ enabled: staff });
  const showCustomer = staff && customers.length > 1;
  /**
   * Selecting rows is only worth offering to somebody who can act on them.
   *
   * Everything the bulk bar does — assign, change status, change priority — is
   * `ticket:write`, so a requester was being shown checkboxes, a select-all,
   * and a toolbar whose every button 403s on every selected row. The column and
   * the bar are both gone for them now.
   *
   * Note this is NOT the `staff` check above it: that one guards the tenant
   * column and is a question about role and reach, not about a permission. The
   * two happen to answer the same for the seeded grants and stop doing so the
   * moment somebody edits the matrix, which is the whole reason they are asked
   * separately.
   */
  const canSelect = hasPermission(user, "ticket:write");
  const cols = showCustomer
    ? canSelect
      ? COLS_WITH_CUSTOMER
      : COLS_NO_SELECT_WITH_CUSTOMER
    : canSelect
      ? COLS
      : COLS_NO_SELECT;
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
    const filters = {
      query,
      statuses,
      priorities,
      assignees,
      customers: selectedCustomers,
      slaStates,
    };
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
    selectedCustomers,
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
      {/* Narrower by the 40px the select column is not taking. */}
      <TableScroll
        minWidth={(showCustomer ? 1090 : 960) - (canSelect ? 0 : 40)}
      >
      {/* header */}
      <div
        className={cn(
          "grid items-center border-b border-hairline bg-wash px-4 py-2.5 text-caption font-semibold tracking-columns text-faint",
          cols,
        )}
      >
        {canSelect ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected}
            aria-label={t("tickets.selectAll")}
            onClick={toggleAll}
            // 40px wide, not the usual 44: the checkbox column is 40px, and a
            // wider box spilled 4px onto the ID sort button beside it, so the far
            // left of that header toggled select-all instead of sorting.
            className="grid w-fit place-items-center rounded [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-10"
          >
            <Checkbox checked={allSelected} />
          </button>
        ) : null}
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
        {showCustomer ? <span>{t("col.customer")}</span> : null}
      </div>

      {isLoading ? <LoadingRow /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}
      {/* Two different situations, and they used to share one sentence: a queue
          filtered down to nothing, and a queue with nothing in it. A fresh install
          read "no tickets match your filters" with no filter set, which sends the
          reader looking for a filter to clear that was never there. */}
      {!isLoading && !isError && rows.length === 0 ? (
        <EmptyState
          message={
            // `activeCount` counts the facets only, so the search box has to be
            // asked separately — a query that matches nothing is still a filtered
            // view, and answering "no tickets yet" to it would be the same lie in
            // the other direction.
            activeCount > 0 || query.trim() !== ""
              ? t("tickets.noMatch")
              : t("tickets.empty")
          }
        />
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
              "grid cursor-pointer items-center border-l-[3px] px-4 py-3 text-control",
              cols,
              // One colour class, never two: `cn` is a plain join with no
              // tailwind-merge behind it, so a transparent default left in place
              // would race the real colour on stylesheet order and usually win.
              STRIPE[sla.state] ?? "border-l-transparent",
              i < rows.length - 1 && "border-b border-b-rule",
              isSel ? "bg-accent-tint" : "hover:bg-wash",
            )}
          >
            {canSelect ? (
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
                className="grid w-fit place-items-center rounded [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-10"
              >
                <Checkbox checked={isSel} />
              </button>
            ) : null}
            <span className="font-mono text-dense font-medium text-muted">
              #{t.id}
            </span>
            <span className="flex items-center gap-2 truncate pr-3 font-medium text-ink">
              <span className="truncate">{t.subject}</span>
              {t.attachments > 0 ? (
                <span className="flex flex-none items-center gap-1 text-faint">
                  <Paperclip size={12} strokeWidth={2} />
                  <span className="text-meta">{t.attachments}</span>
                </span>
              ) : null}
            </span>
            <span>
              <StatusBadge status={t.displayStatus} />
            </span>
            <span>
              <SlaBadge sla={sla} />
            </span>
            <PriorityIndicator priority={t.priority} />
            <span className="flex items-center gap-2 text-body text-subtle">
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
            {/* What the person wrote, for a ticket filed under "Other" — a
                column of identical "Other" cells tells a reader working a queue
                nothing at all. `title` carries the full text for one that is
                truncated here. */}
            <span
              className="truncate pr-2 text-body text-subtle"
              title={
                needsOwnDescription(t.categoryCode) && t.categoryOther
                  ? t.categoryOther
                  : undefined
              }
            >
              {needsOwnDescription(t.categoryCode) && t.categoryOther
                ? t.categoryOther
                : t.category}
            </span>
            {showCustomer ? (
              <span className="truncate pr-2 text-body text-subtle">
                {t.customer?.name ?? "—"}
              </span>
            ) : null}
          </div>
        );
      })}
      </TableScroll>

      {/* bulk bar — `canSelect` as well as a selection, so a permission
          revoked while rows were already ticked takes the toolbar away too
          rather than leaving it over a selection nothing can be done with. */}
      {canSelect && selected.size > 0 && rows.length > 0 ? (
        <BulkActionBar
          selectedIds={[...selected]}
          // Which tenants the selection covers, so the Assign menu can offer
          // only people who can see all of them. Usually one — but a
          // platform-wide reader's list spans every customer, and nothing stops
          // them ticking rows from two.
          selectedCustomerIds={[
            ...new Set(
              rows
                .filter((r) => selected.has(r.id))
                .map((r) => r.customer?.id)
                .filter((id): id is number => id != null),
            ),
          ]}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}
