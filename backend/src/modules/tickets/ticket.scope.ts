import { Prisma } from "@prisma/client";
import { isPlatformWide, type AuthUser } from "../../shared/auth";
import type { DisplayStatus, Role } from "../../shared/domain";

/**
 * One display status as a where-clause — the reverse of `displayStatus`.
 *
 * A filter has to select what the reader was shown, and "In Progress" is not a
 * value in the column: it is `new` plus an assignee. Written here, next to the
 * other clause builders, so the list, the board and the dashboard narrow the
 * same way; asking the database for `status = 'in_progress'` would answer with
 * the pre-migration rows only.
 *
 * Only the three stored values are matched — the column cannot hold the older
 * words any more (see the three_state_ticket_status migration), and history rows
 * that still do are read through `displayStatus`, never filtered on here.
 */
export function displayStatusWhere(
  status: DisplayStatus,
): Prisma.TicketWhereInput {
  switch (status) {
    case "closed":
      return { status: "closed" };
    case "pending":
      return { status: "pending" };
    case "in_progress":
      return { status: "new", assigneeId: { not: null } };
    case "new":
      return { status: "new", assigneeId: null };
  }
}

/**
 * Row-level ticket visibility as a Prisma where-clause — the single source of
 * truth for "which tickets can this user see". Used by the ticket repository
 * AND the dashboard/reports aggregates so all three enforce the identical scope
 * and can never drift apart.
 *
 * Multi-tenant: the customer is the isolation boundary.
 *   platform-wide (super_admin with no customer) → every ticket, all customers;
 *   staff pinned to a customer → every ticket of that customer, all departments;
 *   user → only their own tickets.
 * Staff without a customer see nothing but their own tickets (defensive — it
 * shouldn't happen for seeded staff, and must not read as platform-wide).
 */
export function ticketScopeWhere(user: AuthUser): Prisma.TicketWhereInput {
  // Deleted tickets are invisible to EVERYONE, platform-wide reach included —
  // deliberately folded in here rather than added at each call site, because this
  // clause is what the repository, the dashboard aggregates and the closed-ticket
  // history all share. A deletion that only hid the row from lists would still
  // show up in a count somewhere.
  return { deletedAt: null, ...reachWhere(user) };
}

/** Which tickets this user's reach covers, before the deleted-row filter. */
function reachWhere(user: AuthUser): Prisma.TicketWhereInput {
  if (isPlatformWide(user)) return {};
  if (user.role === "user") return { requesterId: user.id };
  // admin + a customer-bound super_admin: their whole customer, every department.
  if (user.customerId == null) return { requesterId: user.id };
  return { customerId: user.customerId };
}

/** A prospective assignee, reduced to what the decision below needs. */
export type AssignmentCandidate = {
  id: number;
  role: Role;
  customerId: number | null;
  /** False = the account is closed; see User.isActive. */
  isActive: boolean;
};

/**
 * May `actor` hand a queue of tickets to `candidate`?
 *
 * Pure so it can be unit tested, like the where-clause builders above. Which
 * *tickets* move is decided by `ticketScopeWhere` in the repository; this decides
 * only who is allowed to receive them, which that clause cannot express.
 *
 *   user candidate       → never; users raise tickets, they don't hold queues
 *   platform-wide actor  → any staff member, any customer
 *   customer-bound actor → only staff inside their own customer
 *
 * A customer-less actor who is not platform-wide can grant nothing, mirroring how
 * `ticketScopeWhere` grants that same user nothing beyond their own tickets.
 */
export function mayReceiveAssignment(
  actor: AuthUser,
  candidate: AssignmentCandidate,
): boolean {
  if (candidate.role === "user") return false;
  // A closed account cannot be handed work. Checked before reach, because it is
  // true regardless of who is asking — and this being the one decision point for
  // "who may receive" is what makes it hold for a single ticket, a whole queue
  // handover, and owning a routing project alike.
  if (!candidate.isActive) return false;
  if (isPlatformWide(actor)) return true;
  if (actor.customerId == null) return false;
  return candidate.customerId === actor.customerId;
}

/** A prospective requester for an imported row, reduced to what the decision needs. */
export type RequesterCandidate = {
  id: number;
  customerId: number | null;
};

/**
 * May `actor` file a ticket on behalf of `candidate`?
 *
 * The CSV import resolves each row's requester by email, and `create` files the
 * ticket under *that requester's* customer — so without this check an importer
 * naming an address outside their own tenant writes a ticket into someone else's,
 * which no clause on the read path can undo. It also disappears from the
 * importer's own list while the batch still reports it created, because the
 * ticket is now behind `ticketScopeWhere` for a customer they do not reach.
 *
 *   platform-wide actor  → any user, any customer
 *   customer-bound actor → only users inside their own customer
 *
 * Same shape as `mayReceiveAssignment` above, and for the same reason: which
 * tickets a caller may read is a where-clause, but who they may name is a
 * decision, and it belongs beside the other one rather than inline in the service.
 */
export function mayImportForRequester(
  actor: AuthUser,
  candidate: RequesterCandidate,
): boolean {
  if (isPlatformWide(actor)) return true;
  if (actor.customerId == null) return false;
  return candidate.customerId === actor.customerId;
}
