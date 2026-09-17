/**
 * Two different questions, and neither is answered from a table in this file
 * any more.
 *
 * **"May I?" → `hasPermission`,** which reads the list the server put on the
 * session — the live matrix.
 *
 * **"What does each role hold?" → `GET /permissions/matrix`,** read by the
 * Permissions page through `features/permissions`.
 *
 * There used to be a `ROLE_PERMISSIONS` constant here holding the grants a
 * fresh install starts with, and both questions were once answered from it.
 * That was the bug twice over: screens asked `holds(user.role, …)` to decide
 * whether to show a control, which is the static table pretending to be the
 * live one; and the Permissions page drew its whole role × capability table
 * from it, which told every desk that had edited its matrix something untrue.
 * It is gone rather than merely unused — a copy of the grants sitting in the
 * client is a thing the next screen reaches for.
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
 * May this person see how much work OTHERS are carrying? Mirrors
 * `maySeeTeamWorkload` in the API's `shared/auth.ts`.
 *
 * NOT expressible as a permission, and that is the point: there is no route
 * gated on one, so any grant name invented for it would be a string the
 * catalogue does not define — ungrantable on the matrix, and satisfied only by
 * a wildcard, which is the same answer as checking the role reached by a longer
 * route that also passes for every string nobody ever defined. So it names the
 * role, on both sides, in one function each.
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
