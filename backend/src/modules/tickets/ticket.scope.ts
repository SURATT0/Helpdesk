import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import type { Role } from "../../shared/domain";

/**
 * Row-level ticket visibility as a Prisma where-clause — the single source of
 * truth for "which tickets can this user see". Used by the ticket repository
 * AND the dashboard/reports aggregates so all three enforce the identical scope
 * and can never drift apart.
 *
 * Multi-tenant: the customer is the isolation boundary.
 *   platform-wide (super_admin with no customer) → every ticket, all customers;
 *   staff with reach → every ticket of every customer they reach, all departments;
 *   user → only their own tickets.
 * Staff who reach no customer see nothing but their own tickets (defensive — it
 * shouldn't happen for seeded staff, and must not read as platform-wide).
 *
 * Reach is usually the one customer they belong to, and is wider only for
 * someone granted it (`user_customers`) — which is why this asks
 * `customerReach` rather than reading `customerId`.
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
  // admin + a customer-bound super_admin: every department of every customer
  // they reach — normally just their own.
  const reach = customerReach(user);
  if (reach.length === 0) return { requesterId: user.id };
  return { customerId: { in: reach } };
}

/**
 * Is that customer one this actor may act in?
 *
 * The read-side counterpart is `reachWhere` above; this is the same question
 * asked about one row instead of a whole list, and the two decisions live
 * together so they cannot answer differently. A candidate with no customer is
 * outside everyone's reach but a platform-wide actor's — reaching "no customer"
 * is not something a grant can express.
 */
function withinReach(actor: AuthUser, customerId: number | null): boolean {
  if (isPlatformWide(actor)) return true;
  if (customerId == null) return false;
  return customerReach(actor).includes(customerId);
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
 *   actor with reach     → only staff inside a customer they reach
 *
 * An actor who reaches no customer and is not platform-wide can grant nothing,
 * mirroring how `ticketScopeWhere` grants them nothing beyond their own tickets.
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
  return withinReach(actor, candidate.customerId);
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
 *   actor with reach     → only users inside a customer they reach
 *
 * Same shape as `mayReceiveAssignment` above, and for the same reason: which
 * tickets a caller may read is a where-clause, but who they may name is a
 * decision, and it belongs beside the other one rather than inline in the service.
 */
export function mayImportForRequester(
  actor: AuthUser,
  candidate: RequesterCandidate,
): boolean {
  return withinReach(actor, candidate.customerId);
}
