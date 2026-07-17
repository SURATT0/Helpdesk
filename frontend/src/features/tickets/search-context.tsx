"use client";

import * as React from "react";
import type { Priority, TicketStatus } from "@/lib/domain";

type TicketLike = {
  subject: string;
  id: number;
  requester: string;
  status: TicketStatus;
  priority: Priority;
  assignee: string | null;
};

type SearchValue = {
  query: string;
  setQuery: (q: string) => void;
  statuses: Set<TicketStatus>;
  toggleStatus: (s: TicketStatus) => void;
  priorities: Set<Priority>;
  togglePriority: (p: Priority) => void;
  assigneeMe: boolean;
  setAssigneeMe: (b: boolean) => void;
  clearFilters: () => void;
  /** Count of active facet filters (excludes the free-text query). */
  activeCount: number;
};

const SearchContext = React.createContext<SearchValue | null>(null);

/** Shared ticket search + filter state (topbar search + tickets filter bar). */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = React.useState("");
  const [statuses, setStatuses] = React.useState<Set<TicketStatus>>(
    () => new Set(),
  );
  const [priorities, setPriorities] = React.useState<Set<Priority>>(
    () => new Set(),
  );
  const [assigneeMe, setAssigneeMe] = React.useState(false);

  const toggleStatus = React.useCallback((s: TicketStatus) => {
    setStatuses((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const togglePriority = React.useCallback((p: Priority) => {
    setPriorities((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }, []);

  const clearFilters = React.useCallback(() => {
    setStatuses(new Set());
    setPriorities(new Set());
    setAssigneeMe(false);
  }, []);

  const value = React.useMemo<SearchValue>(
    () => ({
      query,
      setQuery,
      statuses,
      toggleStatus,
      priorities,
      togglePriority,
      assigneeMe,
      setAssigneeMe,
      clearFilters,
      activeCount:
        statuses.size + priorities.size + (assigneeMe ? 1 : 0),
    }),
    [
      query,
      statuses,
      toggleStatus,
      priorities,
      togglePriority,
      assigneeMe,
      clearFilters,
    ],
  );

  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
}

export function useSearch(): SearchValue {
  const ctx = React.useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}

/** Free-text match on subject / #id / requester. */
export function matchesQuery(t: TicketLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    t.subject.toLowerCase().includes(q) ||
    String(t.id).includes(q) ||
    t.requester.toLowerCase().includes(q)
  );
}

/** Combined query + facet filter used by both the table and the board. */
export function matchesFilters(
  t: TicketLike,
  f: Pick<SearchValue, "query" | "statuses" | "priorities" | "assigneeMe">,
  meName: string | null,
): boolean {
  if (!matchesQuery(t, f.query)) return false;
  if (f.statuses.size > 0 && !f.statuses.has(t.status)) return false;
  if (f.priorities.size > 0 && !f.priorities.has(t.priority)) return false;
  if (f.assigneeMe && (!meName || t.assignee !== meName)) return false;
  return true;
}
