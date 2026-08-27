import { BADGE, type BadgePair } from "./badge-pairs";

/**
 * Everything true about ticket status, in one file — the client's half of
 * `backend/src/shared/ticket-status.ts`.
 *
 * Three values are STORED, four are SHOWN, and the fourth ("In Progress") is a
 * fact the row already carries: an unfinished ticket with an assignee. Anything
 * that renders, filters or groups by status reads from here rather than
 * restating the rule.
 *
 * `toQueryFilter` has no mirror here on purpose — it speaks Prisma, and the
 * client filters by sending the display status to the API, which applies it.
 */

/**
 * What `tickets.status` can hold, mirroring the API's enum.
 *
 *   new      nobody has finished it — the queue, taken or not
 *   pending  the work is done and it is waiting on the requester
 *   closed   over
 */
export const DB_STATUSES = ["new", "pending", "closed"] as const;
export type TicketStatus = (typeof DB_STATUSES)[number];

/**
 * What a reader is shown, in flow order: New → In Progress → Pending → Closed.
 * Board columns, filter options and chart buckets all read this list, so they
 * cannot disagree about which states exist or what order they come in.
 */
export const DISPLAY_STATUSES = [
  "new",
  "in_progress",
  "pending",
  "closed",
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/**
 * The wider vocabulary a ticket's history can hold: `ticket_status_history` is
 * append-only, so rows written before the three-value model still say `open`,
 * `in_progress` and `resolved`. No ticket can be STORED as one of these.
 */
export const HISTORY_STATUSES = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
] as const;
export type TicketStatusRecord = (typeof HISTORY_STATUSES)[number];

/**
 * The status to show for a ticket.
 *
 * The server sends `displayStatus` on every ticket and that is what the UI
 * renders; this exists for the few places holding a ticket shape the server did
 * not build (an optimistic row mid-mutation), so those cannot invent a different
 * rule. Takes the whole ticket, because the answer depends on two columns.
 */
export function getDisplayStatus(ticket: {
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
    default: // new | open — taken or not is what separates them
      return ticket.assigneeId != null ? "in_progress" : "new";
  }
}

/**
 * The statuses where the desk's work is over.
 *
 * `pending` counts: the work is done and `resolved_at` is stamped, so the SLA
 * clock has stopped and there is a verdict rather than a countdown — the
 * requester still has to answer, but that is their clock, not the desk's. Same
 * rule as the API's `deriveSla`.
 */
export const FINISHED_STATUSES = [
  "pending",
  "closed",
] as const satisfies readonly TicketStatus[];

/** Is the desk's work on this ticket over? Accepts the historical words too. */
export function isFinished(status: TicketStatusRecord): boolean {
  return (
    (FINISHED_STATUSES as readonly string[]).includes(status) ||
    status === "resolved"
  );
}

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

/**
 * Label and colour per status word. Keyed by the union of what is DISPLAYED and
 * what history can hold, because both go through the same badge: a board column
 * says "In Progress" (derived) while a timeline row may still say "Resolved"
 * (written before the column narrowed). The label here is the fallback; screens
 * take the translated one from the `status.*` dictionary keys.
 */
export const STATUS_META: Record<
  DisplayStatus | TicketStatusRecord,
  { label: string } & BadgePair
> = {
  new: { label: "New", ...BADGE.blue },
  in_progress: { label: "In Progress", ...BADGE.amber },
  pending: { label: "Pending", ...BADGE.violet },
  closed: { label: "Closed", ...BADGE.slate },
  // Historical only — reachable from a timeline row, never from a ticket.
  open: { label: "Open", ...BADGE.sky },
  resolved: { label: "Resolved", ...BADGE.green },
};
