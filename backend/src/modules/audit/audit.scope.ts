import { Prisma } from "@prisma/client";
import { isPlatformWide, type AuthUser } from "../../shared/auth";

/**
 * Row-level audit visibility as a Prisma where-clause — the audit equivalent of
 * `ticketScopeWhere`, and enforced in the repository the same way.
 *
 * `audit_logs` has no `customer_id` of its own, so the tenant is derived from the
 * ACTOR (`audit_logs.user_id → users.customer_id`):
 *   platform-wide → every entry, all customers, including system rows;
 *   customer-bound super_admin → entries written by users of their own customer;
 *   anyone else   → nothing (the route also requires `audit:read`).
 *
 * KNOWN LIMITATION, deliberate: entries with a null actor (system writes, e.g.
 * a requester auto-created from an inbound email) and entries written by a
 * platform admin acting on a customer's data are attributed to no customer, so a
 * customer-bound viewer does not see them. That under-reports rather than leaking across
 * tenants — the safe direction for a compliance view, and the reason this is a
 * where-clause and not a post-filter. Full coverage needs a `customer_id` column
 * on `audit_logs` populated at write time; see the PR notes.
 */
export function auditScopeWhere(user: AuthUser): Prisma.AuditLogWhereInput {
  if (isPlatformWide(user)) return {};
  // Ids are positive autoincrements, so this matches nothing — the same
  // "no tenant, no scope" sentinel problemScopeWhere uses.
  if (user.customerId == null) return { id: -1 };
  return { user: { customerId: user.customerId } };
}
