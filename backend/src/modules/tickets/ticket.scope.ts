import { Prisma } from "@prisma/client";
import { isPlatformWide, type AuthUser } from "../../shared/auth";
import type { Role } from "../../shared/domain";

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
  if (isPlatformWide(actor)) return true;
  if (actor.customerId == null) return false;
  return candidate.customerId === actor.customerId;
}
