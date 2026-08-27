import type { Prisma } from "@prisma/client";

/**
 * Everything true about ticket status, in one file.
 *
 * There are two vocabularies and they are not the same size, which is the whole
 * reason this module exists: three values are STORED, four are SHOWN, and the
 * fourth ("In Progress") is a fact the row already carries — an unfinished
 * ticket with an assignee. Anything that renders, filters, groups or counts by
 * status goes through the helpers here rather than restating the rule; a second
 * copy is a second answer, and the two drift the moment one of them is edited.
 *
 * Mirrored on the client in `frontend/src/lib/ticket-status.ts`, minus
 * `toQueryFilter` — that one speaks Prisma and has no business in a browser.
 */

/**
 * What `tickets.status` can hold.
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
 * The wider vocabulary `ticket_status_history` holds. That table is append-only
 * and the SLA source of truth, so rows written before the three-value model
 * still say `open`, `in_progress` and `resolved`, and anything that renders
 * history has to accept them. No ticket can be STORED as one of these.
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
 * The status to show for a ticket: `status`, with In Progress folded in.
 *
 * Takes the whole ticket rather than a status alone, because the answer depends
 * on two columns — a signature that lets a caller pass a status by itself is a
 * caller that will eventually get New where it should have got In Progress.
 *
 * Accepts the historical words too, so a timeline row renders through the same
 * function as a live ticket: `open` reads as New (nobody took it) or In Progress
 * (somebody did), and `resolved` reads as Pending, which is what it meant.
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
 * One display status as a Prisma where-clause — the reverse of
 * `getDisplayStatus`, and the only correct way to filter by what was shown.
 *
 * `status = 'in_progress'` matches nothing: the column has no such value. The
 * four clauses partition the table exactly — every ticket satisfies precisely
 * one of them — so a set of filters can neither lose a row nor count one twice.
 */
export function toQueryFilter(status: DisplayStatus): Prisma.TicketWhereInput {
  switch (status) {
    case "new":
      return { status: "new", assigneeId: null };
    case "in_progress":
      return { status: "new", assigneeId: { not: null } };
    case "pending":
      return { status: "pending" };
    case "closed":
      return { status: "closed" };
  }
}

/**
 * Allowed status transitions (whitelist). Anything else → 409.
 *
 *   new     → pending   the work is done; the requester is asked to confirm
 *   new     → closed    the desk raised it and finished it, with nobody to ask
 *   pending → new       the requester rejected it, or more work turned up
 *   pending → closed    confirmed, or the 72h sweep closed it
 *   closed  → new       reopened within 30 days (the assignee is kept, so it
 *                       comes back as In Progress rather than into the queue)
 *
 * Taking a ticket is not in here, because taking a ticket is not a status
 * change: assigning it is what turns New into In Progress, and both are `new`.
 */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["pending", "closed"],
  pending: ["new", "closed"],
  closed: ["new"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
