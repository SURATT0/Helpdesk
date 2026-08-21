"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUsers } from "@/features/users/queries";
import type { Priority, TicketStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { toneForName } from "../data";
import { useSearch, type AssigneeKey } from "../search-context";
import type { SlaState } from "../sla";
import { SlaStateLabel } from "./sla-badge";

const STATUSES: TicketStatus[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

// Worst first, same order the SLA column sorts in. `met` and `no_sla` are left
// out on purpose: they are the states with nothing at stake, and a facet is for
// narrowing to work that needs doing.
const SLA_STATES: SlaState[] = [
  "breached_open",
  "at_risk",
  "due_soon",
  "on_track",
  "breached_closed",
];

// `T` allows numbers as well as strings so the same control can list assignee
// ids alongside the `"none"` sentinel, not just string enums.
function FacetDropdown<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  renderOption,
}: {
  label: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  renderOption: (v: T) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const count = selected.size;
  const active = count > 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px]",
          active
            ? "border-[#b4dcc3] bg-[#e4f2ea] font-semibold text-brand-hover"
            : "border-dashed border-[#cbd5e1] font-medium text-muted hover:border-[#94a3b8]",
        )}
      >
        {active ? null : <span className="leading-none">＋</span>}
        {label}
        {active ? (
          <span className="rounded-full bg-[#d3ecdd] px-1.5 text-[11px] font-semibold">
            {count}
          </span>
        ) : null}
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open ? (
        <>
          {/* A tap anywhere closes it. Dimmed below `lg`, where the panel covers
              the list as a sheet rather than sitting beside its chip. */}
          <div
            className="fixed inset-0 z-30 bg-ink/20 lg:z-10 lg:bg-transparent"
            onClick={() => setOpen(false)}
          />
          {/*
            A sheet from the bottom edge below `lg`, a menu beside the chip above it.

            It used to be `absolute left-0` at every width, anchored to the chip's
            left edge with no way to come back. The bar wraps on a narrow screen and
            the chips march rightwards on a wide one, so the panels at the right-hand
            end opened past the edge of the window — the SLA facet overhung by 43px
            at 375, Assignee by 16px at 768 — and since nothing on the page scrolls
            sideways, the clipped part could not be reached at all. Option labels
            like "Breached, still open" lost their ends.

            `lg` rather than the `sm` the closed log uses, because 768 is one of the
            widths that failed; it also lines the behaviour up with the sidebar,
            which is a drawer below exactly this breakpoint.
          */}
          <div
            role="dialog"
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-lg border border-line bg-white p-2 shadow-modal lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-0 lg:top-full lg:z-20 lg:mt-1 lg:max-h-none lg:min-w-[190px] lg:rounded-md lg:p-0 lg:py-1 lg:shadow-modal"
          >
            <div className="mb-1 flex items-center justify-between px-1 lg:hidden">
              <span className="text-[13px] font-semibold text-ink">{label}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("filter.close")}
                className={cn("text-muted", TOUCH_TARGET)}
              >
                <X size={16} />
              </button>
            </div>
            {options.map((o) => {
              const checked = selected.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => onToggle(o)}
                  // Roomier rows on the sheet, where these are finger targets
                  // rather than something a cursor lands on precisely.
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left hover:bg-app lg:rounded-none lg:py-1.5"
                >
                  <span
                    className={cn(
                      "grid h-3.5 w-3.5 flex-none place-items-center rounded-[4px] border",
                      checked
                        ? "border-brand bg-brand text-white"
                        : "border-[#cbd5e1]",
                    )}
                  >
                    {checked ? <Check size={11} strokeWidth={3.5} /> : null}
                  </span>
                  {renderOption(o)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function FilterBar() {
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    query,
    setQuery,
    statuses,
    toggleStatus,
    priorities,
    togglePriority,
    assignees,
    toggleAssignee,
    slaStates,
    toggleSla,
    clearFilters,
    activeCount,
  } = useSearch();

  // Only staff can read the user directory (user:read), and a requester only
  // ever sees their own tickets — an assignee facet would be meaningless there.
  const isStaff =
    user != null &&
    user.role !== "user";
  const { data: users = [] } = useUsers({ enabled: isStaff });

  // Anyone who can hold a queue. Requesters raise tickets, they don't own them.
  const assignable = React.useMemo(
    () => users.filter((u) => u.role !== "user"),
    [users],
  );
  const nameById = React.useMemo(
    () => new Map(assignable.map((u) => [u.id, u.name])),
    [assignable],
  );

  const assigneeOptions: AssigneeKey[] = React.useMemo(
    () => ["none", ...assignable.map((u) => u.id)],
    [assignable],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
      <div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-line bg-white px-3 py-[7px] focus-within:border-brand sm:w-[260px]">
        <Search size={13} strokeWidth={2} className="flex-none text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filter.search")}
          className={cn(
            "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
            FIELD_TEXT_13,
          )}
        />
      </div>

      <FacetDropdown
        label={t("filter.status")}
        options={STATUSES}
        selected={statuses}
        onToggle={toggleStatus}
        renderOption={(s) => <StatusBadge status={s} />}
      />
      <FacetDropdown
        label={t("filter.priority")}
        options={PRIORITIES}
        selected={priorities}
        onToggle={togglePriority}
        renderOption={(p) => <PriorityIndicator priority={p} />}
      />
      <FacetDropdown
        label={t("filter.sla")}
        options={SLA_STATES}
        selected={slaStates}
        onToggle={toggleSla}
        renderOption={(s) => <SlaStateLabel state={s} />}
      />

      {isStaff ? (
        <FacetDropdown
          label={t("filter.assignee")}
          options={assigneeOptions}
          selected={assignees}
          onToggle={toggleAssignee}
          renderOption={(a) =>
            a === "none" ? (
              <span className="text-[12.5px] font-medium text-muted">
                {t("filter.unassigned")}
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar
                  name={nameById.get(a) ?? "?"}
                  tone={toneForName(nameById.get(a) ?? "?")}
                  size={20}
                />
                <span className="truncate text-[12.5px] text-ink">
                  {nameById.get(a)}
                  {user?.id === a ? (
                    <span className="text-faint"> · {t("filter.you")}</span>
                  ) : null}
                </span>
              </span>
            )
          }
        />
      ) : null}

      {activeCount > 0 ? (
        <button
          type="button"
          onClick={clearFilters}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-ink"
        >
          <X size={13} strokeWidth={2} />
          {t("filter.clear")}
        </button>
      ) : null}
    </div>
  );
}
