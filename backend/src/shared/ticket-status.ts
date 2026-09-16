import type { Prisma } from "@prisma/client";

/**
 * Everything true about ticket status, in one file.
 *
 * There are two vocabularies and they are not the same size, which is the whole
 * reason this module exists: four values are STORED, five are SHOWN, and the
 * extra one ("In Progress") is a fact the row already carries — an unfinished
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
 *   new        nobody has finished it — the queue, taken or not
 *   pending    the work is done and it is waiting on the requester
 *   closed     over, because the work was done
 *   cancelled  over, because the person who raised it no longer wants it
 *
 * `cancelled` is a status of its own rather than a flavour of `closed`, and the
 * distinction is the whole reason it exists: a closed ticket is work the desk
 * finished, a cancelled one is work that never happened. Folding them together
 * would put withdrawals into the closed archive, into the desk's handling-time
 * figures and into every "how much did we get through" count — inflating all
 * three with tickets nobody worked.
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
  "cancelled",
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
    case "cancelled":
      // Never derived and never folded into `closed`: a reader has to be able to
      // tell "we finished this" from "they withdrew it" at a glance.
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
    case "cancelled":
      return { status: "cancelled" };
  }
}

/**
 * Allowed status transitions (whitelist). Anything else → 409.
 *
 *   new       → pending    the work is done; the requester is asked to confirm
 *   new       → closed     the desk raised it and finished it, nobody to ask
 *   new       → cancelled  the requester withdrew it before the desk moved it
 *   pending   → new        the requester rejected it, or more work turned up
 *   pending   → closed     confirmed, or the 72h sweep closed it
 *   closed    → new        reopened within 30 days (the assignee is kept, so it
 *                          comes back as In Progress rather than into the queue)
 *   cancelled → new        the desk putting a withdrawal back, see below
 *
 * Taking a ticket is not in here, because taking a ticket is not a status
 * change: assigning it is what turns New into In Progress, and both are `new`.
 *
 * `new → cancelled` is reachable ONLY from the requester's own endpoint
 * (`POST /tickets/:id/cancel`), never from the desk's `PATCH /:id/status` —
 * withdrawing a request is the requester's decision to take, and an agent who
 * wants a ticket gone has `closed`. The whitelist cannot express "who", so the
 * endpoint is where that is enforced; this list only says the MOVE is legal.
 *
 * `cancelled → new` is in here so a cancellation is not a trapdoor. A person can
 * cancel the wrong ticket, and without a way back the only remedy is raising a
 * new one and losing the thread. It is the desk's to do, by the same
 * `PATCH /:id/status` that reopens a closed ticket, and unlike that one it has no
 * 30-day window: `closedAt` is what dates a reopen, and a cancellation
 * deliberately does not set it.
 */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["pending", "closed", "cancelled"],
  pending: ["new", "closed"],
  closed: ["new"],
  cancelled: ["new"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Is this ticket's PUBLIC conversation over?
 *
 * True once a ticket is `closed` or `cancelled` — the two endings. Nobody may
 * post a public message on one: the requester's reply would land on a thread the
 * desk has stopped watching, and an agent's would email somebody about a ticket
 * they cannot answer. The way to say more is to reopen it, which both endings
 * allow and which puts the ticket back in front of the people who work it.
 *
 * Deliberately NOT "is this ticket finished". Internal notes stay open on an
 * ended ticket, and that is the point of asking about the conversation rather
 * than the ticket: the desk's own record of what happened is frequently written
 * after the fact — a supplier credits the invoice a week later, a post-mortem
 * lands — and forcing a reopen to write one down would rewrite the ticket's
 * status history to file a note. A ticket staff raised for themselves is an
 * internal thread with nothing but notes on it (see `isInternalThread`), so this
 * is also what keeps such a ticket writable at all once it is done.
 */
export function isConversationClosed(status: TicketStatusRecord): boolean {
  return status === "closed" || status === "cancelled";
}

/**
 * Does this move have to say what was DONE?
 *
 * Both moves out of `new` are the desk declaring the work finished, and those
 * are the two that must carry a resolution: `new → pending` hands it to the
 * requester to check, `new → closed` is the desk having raised and finished it
 * with nobody to ask. Finishing a ticket without a sentence saying how leaves
 * the next person reading a closed row with the problem and no answer.
 *
 * The other three moves deliberately do NOT require one, each for its own
 * reason, and they are not oversights:
 *
 *   pending → closed  the requester agreeing, or the 72h sweep giving up.
 *                     Neither of them did the work, so neither can describe it
 *                     — and the resolution the desk wrote on the way INTO
 *                     `pending` is already on the row.
 *   pending → new     a rejection, which carries its own reason as a public
 *                     comment (see `rejectClosure`).
 *   closed  → new     a reopen. The old resolution stays; what replaces it is
 *                     whatever the desk writes when it finishes again.
 *
 * Keyed on the PAIR rather than on the destination, because `closed` is reached
 * from two directions and only one of them is somebody finishing work.
 */
export function requiresResolution(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return from === "new" && (to === "pending" || to === "closed");
}
