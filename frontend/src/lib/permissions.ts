/**
 * Two different questions live in this file, and they have different answers.
 *
 * **"May I?" → `hasPermission`,** which reads the list the server put on the
 * session. That is the live matrix, and it is the only thing a screen may use
 * to decide what to offer.
 *
 * **"What does each role hold?" → `ROLE_PERMISSIONS` below,** a static copy of
 * the grants a fresh install starts with. It is documentation, not an answer
 * about any actual person, and it is KNOWN to be stale — see its own note.
 *
 * They used to be one thing, and that was the bug: screens asked
 * `holds(user.role, "customer:archive")` to decide whether to show a control,
 * which is the static table pretending to be the live one.
 */

import type { Role } from "./domain";
import type { AuthUser } from "@/features/auth/schemas";

/**
 * May this person do `permission`?
 *
 * The client's half of the permission matrix, and the ONLY way a screen may ask
 * what the viewer is allowed to do. `user.permissions` is sent by the server on
 * the session payload, read from `role_permissions` — the same table every gate
 * on the API consults — so an edit in the matrix screen reaches the UI instead
 * of stopping at it.
 *
 * This replaced six hard-coded role lists, of which
 * `WRITE_ROLES = ["super_admin", "admin"]` was copied into two files. Every one
 * of them named the grant it was mirroring in a comment directly above itself,
 * which is how the drift stayed invisible: the code said "admin", the comment
 * said `ticket:write`, and only one of them changed when somebody edited the
 * matrix.
 *
 * **Not a gate.** Every endpoint checks for itself against the live grants at
 * request time; this list is a snapshot from when the session payload was built
 * and goes stale the moment the matrix is edited. Use it to decide what to
 * OFFER and let the API answer the request. Both error directions are safe and
 * self-correcting: a control offered in error is refused with a 403 the screen
 * already handles, and one hidden in error comes back at the next `/auth/me`,
 * token refresh or reload.
 *
 * Signed out (`null`) is false, which offers nothing rather than offering
 * everything to somebody with no session at all.
 */
export function hasPermission(
  user: Pick<AuthUser, "permissions"> | null | undefined,
  permission: string,
): boolean {
  // The list is absent rather than empty for a session object that never went
  // through `authUserSchema` — a payload cached by an older build, say. Treated
  // as "nothing granted" rather than dereferenced, because the alternative is a
  // TypeError inside a render, and a blank screen is a worse way to find out
  // than a missing button.
  const granted = user?.permissions;
  if (!granted) return false;
  // `*` mirrors the server's own `hasPermission`. Nothing writes it into
  // `role_permissions` today — the top role holds an expanded list of every key
  // instead — but the server still honours it, and a client that did not would
  // hide the whole app from whoever the two disagreed about.
  return granted.includes("*") || granted.includes(permission);
}

/** Roles in ascending privilege — the column order of the matrix. */
export const ROLES = ["user", "admin", "super_admin"] as const satisfies readonly Role[];

/**
 * The grants each role STARTS with, mirroring `INITIAL_ROLE_PERMISSIONS` in the
 * API's `shared/permissions.ts`.
 *
 * **This is not what any role currently holds, and it cannot be.** Grants moved
 * into `role_permissions` and became editable from the Permissions screen; this
 * constant is the state of a fresh install and nothing keeps it in step with a
 * desk that has edited its matrix. It is already visibly behind — `admin` holds
 * `customer:write` on the server and not here.
 *
 * Used by exactly one screen: the all-roles table on the Permissions page,
 * which sets out what each role may do. That page needs every role's grants,
 * not the viewer's, and the API's `GET /permissions/matrix` is deliberately
 * gated on `permission:write` — "the people who may look at it are the people
 * who may change it" — so there is nothing live for it to read. Fixing that
 * needs a product decision about who may see the matrix, not another mirror.
 *
 * **Never use this to decide what to offer somebody.** That is `hasPermission`
 * above, which asks about the actual person in front of you.
 */
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
