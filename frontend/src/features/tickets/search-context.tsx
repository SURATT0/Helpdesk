"use client";

import * as React from "react";
import type { DisplayStatus, Priority, TicketStatus } from "@/lib/domain";
import { judgeSla, type SlaState } from "./sla";

type TicketLike = {
  subject: string;
  id: number;
  requester: string;
  /** Stored value — the SLA judgement reads this. */
  status: TicketStatus;
  /** What the row shows, and therefore what the status facet filters on. */
  displayStatus: DisplayStatus;
  priority: Priority;
  assignee: string | null;
  assigneeId: number | null;
  /**
   * Optional so callers that only filter on the other facets — and the tests
   * that predate the SLA facet — don't have to supply timestamps they never use.
   * Absent reads as "no SLA target", which is what the badge shows too.
   */
  dueAt?: string | null;
  resolvedAt?: string | null;
  /** The ticket's customer's "due soon" window; absent falls back to the default. */
  slaWarnMs?: number;
};

/**
 * A selectable assignee: a user id, or the sentinel `"none"` for the unassigned
 * queue. Keyed on id rather than display name because names are not unique.
 */
export type AssigneeKey = number | "none";

type SearchValue = {
  query: string;
  setQuery: (q: string) => void;
  statuses: Set<DisplayStatus>;
  toggleStatus: (s: DisplayStatus) => void;
  priorities: Set<Priority>;
  togglePriority: (p: Priority) => void;
  /** Empty = no assignee filter, which is NOT the same as selecting "none". */
  assignees: Set<AssigneeKey>;
  toggleAssignee: (a: AssigneeKey) => void;
  slaStates: Set<SlaState>;
  toggleSla: (s: SlaState) => void;
  /** Replace the SLA selection outright — the summary tiles jump straight to one. */
  setSlaOnly: (s: SlaState) => void;
  clearFilters: () => void;
  /** Count of active facet filters (excludes the free-text query). */
  activeCount: number;
};

const SearchContext = React.createContext<SearchValue | null>(null);

/** Shared ticket search + filter state (topbar search + tickets filter bar). */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = React.useState("");
  const [statuses, setStatuses] = React.useState<Set<DisplayStatus>>(
    () => new Set(),
  );
  const [priorities, setPriorities] = React.useState<Set<Priority>>(
    () => new Set(),
  );
  const [assignees, setAssignees] = React.useState<Set<AssigneeKey>>(
    () => new Set(),
  );
  const [slaStates, setSlaStates] = React.useState<Set<SlaState>>(
    () => new Set(),
  );

  const toggleStatus = React.useCallback((s: DisplayStatus) => {
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

  const toggleSla = React.useCallback((s: SlaState) => {
    setSlaStates((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  // Clicking a summary tile means "show me these", not "add these to whatever I
  // had" — and clicking the tile that is already showing goes back to everything.
  const setSlaOnly = React.useCallback((s: SlaState) => {
    setSlaStates((prev) =>
      prev.size === 1 && prev.has(s) ? new Set() : new Set([s]),
    );
  }, []);

  const clearFilters = React.useCallback(() => {
    setStatuses(new Set());
    setPriorities(new Set());
    setAssignees(new Set());
    setSlaStates(new Set());
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
      slaStates,
      toggleSla,
      setSlaOnly,
      clearFilters,
      activeCount:
        statuses.size + priorities.size + assignees.size + slaStates.size,
    }),
    [
      query,
      statuses,
      toggleStatus,
      priorities,
      togglePriority,
      assignees,
      toggleAssignee,
      slaStates,
      toggleSla,
      setSlaOnly,
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

/**
 * Combined query + facet filter used by both the table and the board.
 *
 * `now` is a parameter so a caller that already holds a ticking clock filters
 * against the same instant it renders the badges with — otherwise a row could
 * be counted as at-risk and drawn as breached in the same paint.
 */
export function matchesFilters(
  t: TicketLike,
  f: Pick<
    SearchValue,
    "query" | "statuses" | "priorities" | "assignees"
  > & { slaStates?: Set<SlaState> },
  now: number = Date.now(),
): boolean {
  if (!matchesQuery(t, f.query)) return false;
  // The facet lists what the badges say, so it matches on the shown value.
  if (f.statuses.size > 0 && !f.statuses.has(t.displayStatus)) return false;
  if (f.priorities.size > 0 && !f.priorities.has(t.priority)) return false;
  if (f.assignees.size > 0) {
    // An unassigned ticket only matches the explicit "none" selection.
    const key: AssigneeKey = t.assigneeId ?? "none";
    if (!f.assignees.has(key)) return false;
  }
  if (f.slaStates && f.slaStates.size > 0) {
    const { state } = judgeSla(
      {
        dueAt: t.dueAt ?? null,
        status: t.status,
        resolvedAt: t.resolvedAt ?? null,
        slaWarnMs: t.slaWarnMs,
      },
      now,
    );
    if (!f.slaStates.has(state)) return false;
  }
  return true;
}
