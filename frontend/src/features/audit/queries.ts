import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchAuditActions, fetchAuditLog, type AuditFilter } from "./api";

export const auditKeys = {
  all: ["audit"] as const,
  page: (f: AuditFilter) => ["audit", "page", f] as const,
  actions: ["audit", "actions"] as const,
};

/**
 * One page of the trail. `keepPreviousData` holds the current rows on screen
 * while the next page loads, so paging doesn't flash an empty table.
 */
export function useAuditLog(filter: AuditFilter) {
  return useQuery({
    queryKey: auditKeys.page(filter),
    queryFn: () => fetchAuditLog(filter),
    placeholderData: keepPreviousData,
  });
}

/** Distinct action names in the viewer's scope, for the filter dropdown. */
export function useAuditActions(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: auditKeys.actions,
    queryFn: fetchAuditActions,
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000, // the action vocabulary changes rarely
  });
}
