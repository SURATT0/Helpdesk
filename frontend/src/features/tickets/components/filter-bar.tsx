"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { useI18n } from "@/features/i18n/context";
import type { Priority, TicketStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useSearch } from "../search-context";

const STATUSES: TicketStatus[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

function FacetDropdown<T extends string>({
  label,
  options,
  selected,
  onToggle,
  renderOption,
}: {
  label: string;
  options: T[];
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
  const {
    query,
    setQuery,
    statuses,
    toggleStatus,
    priorities,
    togglePriority,
    assigneeMe,
    setAssigneeMe,
    clearFilters,
    activeCount,
  } = useSearch();

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

      <button
        type="button"
        onClick={() => setAssigneeMe(!assigneeMe)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px]",
          assigneeMe
            ? "border-[#b4dcc3] bg-[#e4f2ea] font-semibold text-brand-hover"
            : "border-dashed border-[#cbd5e1] font-medium text-muted hover:border-[#94a3b8]",
        )}
      >
        {assigneeMe ? (
          <Check size={12} strokeWidth={3} />
        ) : (
          <span className="leading-none">＋</span>
        )}
        {t("filter.assigneeMe")}
      </button>

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
