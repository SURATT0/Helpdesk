import { BADGE, type ColourPair } from "./palette";

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
 *   new        nobody has finished it — the queue, taken or not
 *   pending    the work is done and it is waiting on the requester
 *   closed     over, because the work was done
 *   cancelled  over, because the person who raised it withdrew it
 */
export const DB_STATUSES = ["new", "pending", "closed", "cancelled"] as const;
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
  "cancelled",
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
  "cancelled",
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
    case "cancelled":
      return "cancelled";
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
 *
 * `cancelled` is deliberately NOT here. The desk's work being over and there
 * having been no work are different facts, and this list feeds the SLA verdict:
 * a withdrawn ticket has a target it was never asked to meet, so calling it
 * finished would score it "met". `assess` short-circuits it to `no_sla` before
 * this list is consulted, the same way the API's `deriveSla` does.
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
  new: ["pending", "closed", "cancelled"],
  pending: ["new", "closed"],
  closed: ["new"],
  cancelled: ["new"],
};

/**
 * The moves the DESK's status control may offer — the whitelist minus
 * `cancelled`.
 *
 * Withdrawing a request belongs to the person who made it, and the API keeps
 * `cancelled` off `PATCH /:id/status` entirely (see `deskSettableStatus` there).
 * Offering it in the dropdown would be offering a move the server refuses.
 */
export function deskTransitionsFrom(status: TicketStatus): TicketStatus[] {
  return (STATUS_TRANSITIONS[status] ?? []).filter((s) => s !== "cancelled");
}

/**
 * Is this ticket's public conversation over? Mirrors `isConversationClosed` in
 * the API's `shared/ticket-status.ts`.
 *
 * Used to decide whether to OFFER the composer. The server refuses a public
 * comment on such a ticket regardless of what this returns; hiding the box is so
 * somebody does not type a paragraph into a thread nobody is reading and find
 * out on submit.
 */
export function isConversationClosed(status: TicketStatusRecord): boolean {
  return status === "closed" || status === "cancelled";
}

/**
 * Label and colour per status word. Keyed by the union of what is DISPLAYED and
 * what history can hold, because both go through the same badge: a board column
 * says "In Progress" (derived) while a timeline row may still say "Resolved"
 * (written before the column narrowed). The label here is the fallback; screens
 * take the translated one from the `status.*` dictionary keys.
 */
export const STATUS_META: Record<
  DisplayStatus | TicketStatusRecord,
  { label: string } & ColourPair
> = {
  new: { label: "New", ...BADGE.blue },
  in_progress: { label: "In Progress", ...BADGE.amber },
  pending: { label: "Pending", ...BADGE.violet },
  closed: { label: "Closed", ...BADGE.slate },
  // Rose, not the slate `closed` wears. Both are endings, and a reader scanning
  // a list has to be able to tell the one where the work was done from the one
  // where it never happened — two greys would have made them the same glance.
  cancelled: { label: "Cancelled", ...BADGE.rose },
  // Historical only — reachable from a timeline row, never from a ticket.
  open: { label: "Open", ...BADGE.sky },
  resolved: { label: "Resolved", ...BADGE.green },
};
