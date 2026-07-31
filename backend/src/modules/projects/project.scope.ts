import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";

/**
 * Row-level project visibility, mirroring `ticketScopeWhere` and the user
 * directory's scope: admins span every customer, everyone else is confined to
 * their own, and a non-admin with no customer matches nothing (defensive).
 *
 * This governs reading and administering the project list. It is deliberately
 * NOT used to narrow ticket visibility — a project is a routing dimension, so a
 * ticket routed through one is still visible to every agent of its customer.
 */
export function projectScopeWhere(actor: AuthUser): Prisma.ProjectWhereInput {
  if (actor.role === "admin") return {};
  if (actor.customerId == null) return { id: -1 };
  return { customerId: actor.customerId };
}

/**
 * Which customer a newly created project belongs to.
 *
 * A scoped actor always creates inside their own customer, and any `customerId`
 * they send is ignored rather than honoured — otherwise a manager could plant a
 * project, and therefore a routing target, inside another tenant. Only a platform
 * admin (who has no customer of their own) may name the customer, and must.
 */
export function resolveProjectCustomerId(
  actor: AuthUser,
  requested: number | undefined,
): number | null {
  if (actor.customerId != null) return actor.customerId;
  if (actor.role === "admin" && requested != null) return requested;
  return null;
}
