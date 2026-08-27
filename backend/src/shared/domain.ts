/**
 * Domain vocabulary shared across modules. Kept in sync with the frontend's
 * `src/lib/domain.ts` and the architecture spec.
 */
/**
 * What a ticket is stored as.
 *
 *   new      nobody has finished it — the queue, whether or not someone is on it
 *   pending  the work is done and it is waiting on the requester
 *   closed   over
 *
 * "In Progress" is not here on purpose: it is `new` with an assignee, derived on
 * read (see `displayStatus`). The flow a person sees is
 * New → In Progress → Pending → Closed; the flow the column sees is three
 * values, which is why `assigneeId` is part of every status decision.
 */
export type TicketStatus = "new" | "pending" | "closed";

/**
 * The vocabulary `ticket_status_history` holds, which is wider than what can be
 * stored on a ticket today. That table is append-only, so rows written before
 * the three-value model still say `open`, `in_progress` and `resolved`, and
 * anything that renders history has to accept them.
 */
export type TicketStatusRecord =
  | TicketStatus
  | "open"
  | "in_progress"
  | "resolved";

/**
 * What a reader is shown, which is not the same set as what is stored.
 *
 * "In Progress" is not a status a ticket can be put into — it is the answer to
 * "is anyone on this?", and the row already knows: an unfinished ticket with an
 * assignee is being worked on. Deriving it means the two facts can never
 * disagree, which they could when it was a status of its own: assigning a `new`
 * ticket left it reading as New, and moving one to `in_progress` without an
 * assignee claimed work nobody was doing (the seed still holds one of those).
 */
export type DisplayStatus = "new" | "in_progress" | "pending" | "closed";

/** Display statuses in flow order — the order a board or a filter lists them. */
export const DISPLAY_STATUSES: readonly DisplayStatus[] = [
  "new",
  "in_progress",
  "pending",
  "closed",
];

/**
 * The one definition of the derived state. Every badge, board column, chart and
 * filter goes through this — a second copy is a second answer.
 *
 * Tolerates the pre-migration vocabulary on purpose: `open` reads as New (nobody
 * has taken it) or In Progress (someone has), and a stored `in_progress` /
 * `resolved` maps to what it always meant. That is what lets the UI move to the
 * derived vocabulary before the column is narrowed, rather than in one jump.
 */
export function displayStatus(ticket: {
  status: TicketStatusRecord;
  assigneeId: number | null;
}): DisplayStatus {
  switch (ticket.status) {
    case "closed":
      return "closed";
    case "pending":
    case "resolved": // pre-migration: done, waiting on the requester
      return "pending";
    case "in_progress":
      return "in_progress";
    default: // new | open — taken or not is what separates them
      return ticket.assigneeId != null ? "in_progress" : "new";
  }
}

export type Priority = "low" | "medium" | "high" | "critical";

/**
 * RBAC roles, ordered super_admin > admin > user.
 *
 *   user        raises a ticket, follows it, reads the knowledge base
 *   admin       works cases: replies, reassigns, changes status and priority
 *   super_admin manages the admins, and everything an admin can do
 *
 * The role says WHAT a principal may do. WHICH customers they reach is a separate
 * axis carried by `AuthUser.customerId` — null is platform-wide, a value pins them
 * to that one tenant. Keeping the two apart is what lets a single super_admin role
 * serve both a platform owner and one customer's manager without either gaining
 * the other's reach.
 */
export type Role = "super_admin" | "admin" | "user";

/** Highest first. Index = rank, so a lower index outranks a higher one. */
export const ROLE_ORDER: readonly Role[] = ["super_admin", "admin", "user"];

/** Does `role` sit at or above `minimum` in the hierarchy? */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_ORDER.indexOf(role) <= ROLE_ORDER.indexOf(minimum);
}

/**
 * Does this ticket's conversation have an external side at all?
 *
 * A ticket raised by a `user` has two sides: the requester, who reads the public
 * thread and gets the emails, and the desk, which also has internal notes the
 * requester never sees. A ticket raised by staff has only one — they opened it,
 * they work it, they close it. There is nobody on the other end to chat with or
 * mail, so every message on such a ticket is an internal note and the two-sided
 * composer is asking the reader to pick an audience that does not exist.
 *
 * Keyed on the REQUESTER's role, never the viewer's: if it were the viewer's, a
 * second admin picking up the case would see a chat box while the requesting
 * admin saw notes only, and one of them would be writing into a tab the other
 * cannot answer from. The property belongs to the ticket, so both sides agree.
 */
export function isInternalThread(requesterRole: Role): boolean {
  return requesterRole !== "user";
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
