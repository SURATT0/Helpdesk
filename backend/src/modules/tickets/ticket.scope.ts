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
 * Is that customer one this PRINCIPAL may act in?
 *
 * The read-side counterpart is `reachWhere` above; this is the same question
 * asked about one row instead of a whole list, and the two decisions live
 * together so they cannot answer differently. A customer of `null` is outside
 * everyone's reach but a platform-wide principal's — reaching "no customer" is
 * not something a grant can express.
 *
 * Takes the principal structurally rather than as an `AuthUser`, because it is
 * asked about two different people: the ACTOR, who has been granted reach and
 * carries `customerIds`, and a prospective ASSIGNEE, who is a database row and
 * does not. That absence is not an oversight — `customerReach` reads it as
 * "their own customer and nothing more", which is exactly the rule for an
 * assignee: reach lets somebody SEE a tenant's work, it never makes them a
 * member of it, so a granted agent stays out of that customer's queue the same
 * way they stay out of its directory and its assignee picker.
 */
function withinReach(
  principal: { role: Role; customerId: number | null; customerIds?: number[] },
  customerId: number | null,
): boolean {
  if (isPlatformWide(principal)) return true;
  if (customerId == null) return false;
  return customerReach(principal).includes(customerId);
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
 * May `actor` hand work belonging to `workCustomerId` to `candidate`?
 *
 * Pure so it can be unit tested, like the where-clause builders above. Which
 * *tickets* move is decided by `ticketScopeWhere` in the repository; this decides
 * only who is allowed to receive them, which that clause cannot express.
 *
 * THREE questions, and the third one is easy to forget because two of them
 * collapse into one for most callers:
 *
 *   1. is the candidate the sort of person who holds work at all?
 *      a requester never is, and neither is a closed account
 *   2. may the ACTOR hand work to them?
 *      platform-wide → anyone; otherwise only staff inside a customer they reach
 *   3. can the CANDIDATE see the work being handed over?
 *      platform-wide → yes; otherwise only their own customer's
 *
 * Question 3 is the one that was missing, and its absence did not show for a
 * customer-bound actor: their reach is one customer, the work they can touch is
 * inside it, and question 2 therefore answered 3 by accident. For a
 * platform-wide actor question 2 is vacuous, so nothing was asked at all — an
 * Acme ticket could be assigned to a Globex agent, accepted with a 200, and then
 * 404 for the person it was assigned to. `ticketScopeWhere` still hid it, so
 * nothing leaked; the ticket simply left every queue at once, which is the
 * failure this check's own comment at the call site was written to prevent.
 *
 * Note the asymmetry in how reach is read on each side, which is deliberate:
 * the actor's GRANTED reach counts for question 2, and does not for question 3
 * — see `withinReach`.
 *
 * An actor who reaches no customer and is not platform-wide can grant nothing,
 * mirroring how `ticketScopeWhere` grants them nothing beyond their own tickets.
 */
export function mayReceiveAssignment(
  actor: AuthUser,
  candidate: AssignmentCandidate,
  workCustomerId: number | null,
): boolean {
  if (candidate.role === "user") return false;
  // A closed account cannot be handed work. Checked before reach, because it is
  // true regardless of who is asking — and this being the one decision point for
  // "who may receive" is what makes it hold for a single ticket, a whole queue
  // handover, and owning a routing project alike.
  if (!candidate.isActive) return false;
  if (!withinReach(actor, candidate.customerId)) return false;
  return withinReach(candidate, workCustomerId);
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
