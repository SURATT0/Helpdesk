/**
 * The permission grants per role, mirroring `ROLE_PERMISSIONS` in the API's
 * `shared/auth.ts` — the same mirroring arrangement as `lib/ticket-status.ts`
 * and `lib/domain.ts`.
 *
 * The server is the authority: every grant here is enforced by
 * `requirePermission` on a route, and nothing the client believes changes what
 * the API allows. This copy exists for exactly one screen — the Permissions
 * page, which sets out what each role may do — so that page can DERIVE its
 * table from the grants instead of restating the answer role by role. Hand-
 * written role lists were how it came to claim that only a super_admin may
 * assign a ticket, when `PATCH /tickets/:id/assignee` asks for `ticket:write`
 * and every admin holds it.
 *
 * Keep it in step with the API. `auth.test.ts` on the server pins the admin
 * grant list for that reason: changing it there fails a test that names this
 * file.
 */

import type { Role } from "./domain";

/** Roles in ascending privilege — the column order of the matrix. */
export const ROLES = ["user", "admin", "super_admin"] as const satisfies readonly Role[];

export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  /**
   * `*` — everything an admin can do, plus managing the admins themselves. The
   * wildcard rather than a list is deliberate on the server: a new permission
   * should reach the top role without an edit.
   */
  super_admin: ["*"],
  admin: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "user:read",
    "asset:write",
    "problem:write",
    "asset:read",
    "problem:read",
    "project:read",
    "audit:read",
    "kb:write",
  ],
  /** Raise a ticket and follow it. Reading the KB needs no grant at all. */
  user: ["ticket:read", "ticket:create"],
};

/** Does this role hold the permission? `*` satisfies every check. */
export function holds(role: Role, permission: string): boolean {
  const grants = ROLE_PERMISSIONS[role] ?? [];
  return grants.includes("*") || grants.includes(permission);
}

/**
 * Which roles hold ALL of these permissions.
 *
 * Every permission, not any: a row like "browse the asset & problem registers"
 * is only true for a role that can do both halves, and a role holding one of
 * them would otherwise get a tick for something it cannot finish.
 */
export function rolesHolding(permissions: readonly string[]): Role[] {
  return ROLES.filter((role) => permissions.every((p) => holds(role, p)));
}

/**
 * May this person see how much work OTHERS are carrying? Mirrors
 * `maySeeTeamWorkload` in the API's `shared/auth.ts`.
 *
 * NOT expressible through `holds()` above, and that is the point: `super_admin`
 * holds `*`, so any grant name invented for this would be satisfied by the
 * wildcard and by nothing else — the same answer as checking the role, reached
 * by a longer route that also passes for every string nobody ever defined. So it
 * names the role, on both sides, in one function each.
 *
 * The server refuses the data outright (403 from `/reports/workload/agents`);
 * this exists so the UI can avoid ASKING for what it may not have, and so a
 * per-agent surface is never mounted. It is not the gate.
 */
export function maySeeTeamWorkload(role: Role | undefined): boolean {
  return role === "super_admin";
}

/**
 * May this person see `targetId`'s workload figures? Your own are always yours.
 * Mirrors `maySeeWorkloadOf` in the API's `shared/auth.ts`.
 */
export function maySeeWorkloadOf(
  user: { id: number; role: Role } | null | undefined,
  targetId: number,
): boolean {
  if (!user) return false;
  return targetId === user.id || maySeeTeamWorkload(user.role);
}
