"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
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
  "paused",
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
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[190px] rounded-md border border-line bg-white py-1 shadow-modal">
            {options.map((o) => {
              const checked = selected.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => onToggle(o)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-app"
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
    <div className="flex flex-wrap items-center gap-2 px-6 py-4">
      <div className="flex w-[260px] items-center gap-2 rounded-md border border-line bg-white px-3 py-[7px] text-[13px] focus-within:border-brand">
        <Search size={13} strokeWidth={2} className="flex-none text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filter.search")}
          className="w-full bg-transparent text-ink placeholder:text-faint focus:outline-none"
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
