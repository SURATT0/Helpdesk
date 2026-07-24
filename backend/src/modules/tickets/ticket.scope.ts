import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";

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
