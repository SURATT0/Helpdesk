import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";
import type { Role } from "../../shared/domain";

/**
 * Row-level ticket visibility as a Prisma where-clause — the single source of
 * truth for "which tickets can this user see". Used by the ticket repository
 * AND the dashboard/reports aggregates so all three enforce the identical scope
 * and can never drift apart.
 *
 * Multi-tenant: the customer is the isolation boundary.
 *   admin (customerId null) → every ticket, all customers;
 *   agent / manager → every ticket of their own customer (all departments);
 *   requester → only their own tickets.
 * A non-admin staff user without a customer sees nothing but their own tickets
 * (defensive — shouldn't happen for seeded staff).
 */
export function ticketScopeWhere(user: AuthUser): Prisma.TicketWhereInput {
  if (user.role === "admin") return {};
  if (user.role === "requester") return { requesterId: user.id };
  // agent + manager: their whole customer, across every department.
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
 *   requester candidate → never; requesters raise tickets, they don't hold queues
 *   admin actor         → any staff member, any customer
 *   scoped actor        → only staff inside their own customer
 *
 * A customer-less non-admin actor can grant nothing, mirroring how
 * `ticketScopeWhere` grants that same user nothing beyond their own tickets.
 */
export function mayReceiveAssignment(
  actor: AuthUser,
  candidate: AssignmentCandidate,
): boolean {
  if (candidate.role === "requester") return false;
  if (actor.role === "admin") return true;
  if (actor.customerId == null) return false;
  return candidate.customerId === actor.customerId;
}
