"use client";

import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { matchesFilters, useSearch } from "../search-context";
import { useTickets } from "../queries";

export function TicketListFooter() {
  const { t } = useI18n();
  const { data } = useTickets();
  const { query, statuses, priorities, assignees, slaStates, activeCount } =
    useSearch();

  const all = data?.tickets ?? [];
  const total = data?.total ?? all.length;
  const filtered = all.filter((x) =>
    matchesFilters(x, { query, statuses, priorities, assignees, slaStates }),
  ).length;

  const isFiltered = activeCount > 0 || query.trim().length > 0;

  return (
    <div className="px-4 pb-4 text-[12.5px] text-muted sm:px-6 sm:pb-6">
      {all.length > 0
        ? t(isFiltered ? "filter.showingFiltered" : "filter.showing", {
            shown: filtered,
            total,
          })
        : "—"}
    </div>
  );
}
