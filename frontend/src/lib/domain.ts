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
