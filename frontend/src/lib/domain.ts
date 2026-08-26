/**
 * Domain vocabulary shared across features. Mirrors the architecture spec:
 * status enum `new → open → in_progress → pending → resolved → closed`,
 * priority `low | medium | high | critical`.
 */

export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "pending"
  | "resolved"
  | "closed";

export type Priority = "low" | "medium" | "high" | "critical";

/**
 * Roles, mirroring the API's enum. `features/auth/schemas.ts` owns the runtime
 * parse (`roleSchema`); this is the same union as a type, so the rules below can
 * live here in lib/ without features/ depending on features/.
 */
export type Role = "super_admin" | "admin" | "user";

/**
 * Does this ticket's conversation have an external side at all?
 *
 * Mirrors `isInternalThread` in the API's shared/domain — the server enforces it
 * (a comment on such a ticket is stored as a note, an email reply is refused),
 * and this is what lets the UI stop offering the tabs that would be refused.
 *
 * A ticket raised by a `user` has a requester on the other end to chat with and
 * to mail. One raised by staff does not: they opened it, they work it, they close
 * it, so every message on it is an internal note. Keyed on the REQUESTER's role
 * and not the viewer's, so a second admin picking up the case sees the same
 * one-sided thread the requesting admin does.
 */
export function isInternalThread(requesterRole: Role): boolean {
  return requesterRole !== "user";
}

export const STATUS_META: Record<
  TicketStatus,
  { label: string; fg: string; bg: string }
> = {
  new: { label: "New", fg: "#1d4ed8", bg: "#dbeafe" },
  open: { label: "Open", fg: "#0369a1", bg: "#e0f2fe" },
  in_progress: { label: "In Progress", fg: "#b45309", bg: "#fef3c7" },
  pending: { label: "Pending", fg: "#6d28d9", bg: "#ede9fe" },
  resolved: { label: "Resolved", fg: "#15803d", bg: "#dcfce7" },
  closed: { label: "Closed", fg: "#475569", bg: "#f1f5f9" },
};

export const PRIORITY_META: Record<
  Priority,
  { label: string; dot: string }
> = {
  critical: { label: "Critical", dot: "#dc2626" },
  high: { label: "High", dot: "#f59e0b" },
  medium: { label: "Medium", dot: "#3b82f6" },
  low: { label: "Low", dot: "#94a3b8" },
};

/**
 * Length caps on the free-text fields, mirroring `TEXT_MAX` in the API's
 * `shared/text.ts`. The server is the authority and refuses anything longer
 * with a 400; these exist so a person finds out while typing rather than after
 * submitting, where the only feedback is a flat "Invalid request".
 *
 * Keep the two in step: raising one without the other turns into either a
 * field that refuses what the API accepts, or the vague rejection again.
 */
export const TEXT_MAX = {
  SUBJECT: 200,
  BODY: 20_000,
} as const;

/**
 * Allowed status transitions (whitelist). The service layer would return
 * 409 ILLEGAL_TRANSITION for anything not listed here.
 */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["open", "in_progress"],
  open: ["in_progress", "pending", "resolved"],
  in_progress: ["pending", "resolved"],
  pending: ["in_progress", "resolved"],
  resolved: ["open", "closed"],
  closed: ["open"],
};
