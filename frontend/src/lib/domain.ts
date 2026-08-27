/**
 * Domain vocabulary shared across features. Mirrors the architecture spec:
 * status enum `new → open → in_progress → pending → resolved → closed`,
 * priority `low | medium | high | critical`.
 */

/**
 * What a ticket is stored as, mirroring the API's enum.
 *
 *   new      nobody has finished it — the queue, whether or not it is taken
 *   pending  the work is done and it is waiting on the requester
 *   closed   over
 *
 * The flow a person sees has four steps (New → In Progress → Pending → Closed);
 * the column has three, because In Progress is `new` with an assignee. Anything
 * that RENDERS a status wants DisplayStatus below, not this.
 */
export type TicketStatus = "new" | "pending" | "closed";

/**
 * The vocabulary a ticket's history can hold, which is wider than what can be
 * stored today: `ticket_status_history` is append-only, so rows written before
 * the three-value model still say `open`, `in_progress` and `resolved`.
 */
export type TicketStatusRecord =
  | TicketStatus
  | "open"
  | "in_progress"
  | "resolved";

/**
 * What a reader is shown, which is not the same set as what is stored.
 *
 * Mirrors `DisplayStatus` in the API's shared/domain. "In Progress" is not a
 * status a ticket is put into — it is the answer to "is anyone on this?", which
 * the row already knows from its assignee. The server sends both values on every
 * ticket: `status` to send back on a write, `displayStatus` to render.
 */
export type DisplayStatus = "new" | "in_progress" | "pending" | "closed";

/** Display statuses in flow order — board columns and filter options read this. */
export const DISPLAY_STATUSES: readonly DisplayStatus[] = [
  "new",
  "in_progress",
  "pending",
  "closed",
];

/**
 * The client-side copy of the derivation, for the few places that hold a ticket
 * shape the server did not build (an optimistic row mid-mutation). Prefer the
 * `displayStatus` field the API sends; this exists so those places cannot invent
 * a different rule.
 */
export function displayStatus(ticket: {
  status: TicketStatusRecord;
  assigneeId: number | null;
}): DisplayStatus {
  switch (ticket.status) {
    case "closed":
      return "closed";
    case "pending":
    case "resolved":
      return "pending";
    case "in_progress":
      return "in_progress";
    default:
      return ticket.assigneeId != null ? "in_progress" : "new";
  }
}

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

/**
 * Label and colour per status word. Keyed by the union of what is DISPLAYED and
 * what history can hold, because both go through the same badge: a board column
 * says "In Progress" (derived) while a timeline row may still say "Resolved"
 * (written before the column narrowed).
 */
export const STATUS_META: Record<
  DisplayStatus | TicketStatusRecord,
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
 * Allowed status transitions (whitelist). The service returns
 * 409 ILLEGAL_TRANSITION for anything not listed here.
 *
 * Taking a ticket is missing on purpose: assigning it is what turns New into In
 * Progress, and both are the same stored `new`.
 */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["pending", "closed"],
  pending: ["new", "closed"],
  closed: ["new"],
};
