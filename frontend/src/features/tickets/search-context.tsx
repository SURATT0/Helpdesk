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
  assigneeId: number | null;
};

/**
 * A selectable assignee: a user id, or the sentinel `"none"` for the unassigned
 * queue. Keyed on id rather than display name because names are not unique.
 */
export type AssigneeKey = number | "none";

type SearchValue = {
  query: string;
  setQuery: (q: string) => void;
  statuses: Set<TicketStatus>;
  toggleStatus: (s: TicketStatus) => void;
  priorities: Set<Priority>;
  togglePriority: (p: Priority) => void;
  /** Empty = no assignee filter, which is NOT the same as selecting "none". */
  assignees: Set<AssigneeKey>;
  toggleAssignee: (a: AssigneeKey) => void;
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
  const [assignees, setAssignees] = React.useState<Set<AssigneeKey>>(
    () => new Set(),
  );

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

  const toggleAssignee = React.useCallback((a: AssigneeKey) => {
    setAssignees((prev) => {
      const next = new Set(prev);
      next.has(a) ? next.delete(a) : next.add(a);
      return next;
    });
  }, []);

  const clearFilters = React.useCallback(() => {
    setStatuses(new Set());
    setPriorities(new Set());
    setAssignees(new Set());
  }, []);

  const value = React.useMemo<SearchValue>(
    () => ({
      query,
      setQuery,
      statuses,
      toggleStatus,
      priorities,
      togglePriority,
      assignees,
      toggleAssignee,
      clearFilters,
      activeCount: statuses.size + priorities.size + assignees.size,
    }),
    [
      query,
      statuses,
      toggleStatus,
      priorities,
      togglePriority,
      assignees,
      toggleAssignee,
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
  f: Pick<SearchValue, "query" | "statuses" | "priorities" | "assignees">,
): boolean {
  if (!matchesQuery(t, f.query)) return false;
  if (f.statuses.size > 0 && !f.statuses.has(t.status)) return false;
  if (f.priorities.size > 0 && !f.priorities.has(t.priority)) return false;
  if (f.assignees.size > 0) {
    // An unassigned ticket only matches the explicit "none" selection.
    const key: AssigneeKey = t.assigneeId ?? "none";
    if (!f.assignees.has(key)) return false;
  }
  return true;
}
