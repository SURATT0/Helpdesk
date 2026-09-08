import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";

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
  const reach = customerReach(actor);
  if (reach.length === 0) return { id: -1 };
  return { customerId: { in: reach } };
}

/**
 * Which customer a newly created project belongs to.
 *
 * The rule is reach, not identity: an actor may create inside any customer they
 * reach and nowhere else, because a project is a routing target and planting one
 * in another tenant would route that tenant's work.
 *
 *   reaches exactly one → that one, and `requested` is ignored rather than
 *                         honoured, so a stale or hostile field cannot move it
 *   reaches several     → they must name one, and it must be within reach
 *   platform-wide       → must name one; any customer is within reach
 *   reaches none        → null, and the caller refuses
 *
 * Out of reach returns null rather than the requested id, so the refusal happens
 * in one place. `mayCreateProjectIn` below says whether that null was "you did
 * not choose" or "you may not", which is the difference between a form the user
 * can fix and one they cannot.
 */
export function resolveProjectCustomerId(
  actor: AuthUser,
  requested: number | undefined,
): number | null {
  const reach = customerReach(actor);
  if (isPlatformWide(actor)) return requested ?? null;
  if (reach.length === 1) return reach[0];
  if (requested != null && reach.includes(requested)) return requested;
  return null;
}

/**
 * Does this actor have to be ASKED which customer to create in?
 *
 * True only once reach is wider than one, which is the whole reason the question
 * exists — with a single customer there is nothing to choose and the form should
 * not pretend otherwise.
 */
export function mustChooseProjectCustomer(actor: AuthUser): boolean {
  return isPlatformWide(actor) || customerReach(actor).length > 1;
}
