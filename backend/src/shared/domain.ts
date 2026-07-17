/**
 * Domain vocabulary shared across modules. Kept in sync with the frontend's
 * `src/lib/domain.ts` and the architecture spec.
 */
export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed";

export type Priority = "low" | "medium" | "high" | "critical";

/** RBAC roles, ordered admin > manager > agent > requester. */
export type Role = "admin" | "manager" | "agent" | "requester";

/** Allowed status transitions (whitelist). Anything else → 409. */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["open", "in_progress"],
  open: ["in_progress", "pending", "resolved"],
  in_progress: ["pending", "resolved"],
  pending: ["in_progress", "resolved"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
