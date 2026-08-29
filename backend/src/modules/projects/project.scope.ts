import { Prisma } from "@prisma/client";
import { isPlatformWide, type AuthUser } from "../../shared/auth";

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
  // Deleted projects are invisible to EVERYONE, platform-wide reach included —
  // folded in here rather than added at each call site, exactly as
  // `ticketScopeWhere` does it. That is the whole reason this function is the
  // single door to the table: a soft delete that only hid the row from the list
  // would still leave it selectable in the member picker, and a caller who
  // forgot the clause would be handing out a project nobody can see.
  return { deletedAt: null, ...reachWhere(actor) };
}

/** Which projects this actor's reach covers, before the deleted-row filter. */
function reachWhere(actor: AuthUser): Prisma.ProjectWhereInput {
  if (isPlatformWide(actor)) return {};
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
  if (isPlatformWide(actor) && requested != null) return requested;
  return null;
}
