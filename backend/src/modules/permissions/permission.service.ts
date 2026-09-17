import type { Role } from "@prisma/client";
import { hasPermission, type AuthUser } from "../../shared/auth";
import { BadRequest, Forbidden } from "../../shared/errors";
import {
  isKnownPermission,
  LOCKED_FOR_TOP_ROLE,
  PERMISSIONS,
  type PermissionDef,
} from "../../shared/permissions";
import { currentGrants, grantsFor, replaceGrants } from "./permission.repository";

/** The permission that guards this screen. Itself editable, and itself locked. */
export const PERMISSION_WRITE = "permission:write";

export type PermissionMatrix = {
  /** The catalogue: what the strings mean, for the screen to render. */
  permissions: readonly PermissionDef[];
  /** Who holds what, right now. */
  grants: Record<Role, string[]>;
  /** What `super_admin` may never give up, so the UI can grey those boxes. */
  locked: readonly string[];
};

/**
 * Three rules stand between this screen and an unrecoverable desk. All of them
 * are enforced HERE, on the server, and mirrored in the UI — the mirror is a
 * courtesy, this is the gate.
 */
function assertSafe(
  actor: AuthUser,
  role: Role,
  wanted: Set<string>,
  current: string[],
): void {
  // 1. The two keys that open this door must stay on this side of it.
  //
  // Without `user:write` nobody can change who holds a role; without
  // `permission:write` nobody can change what a role may do. Removing either
  // from the top role is the one edit that could not afterwards be undone from
  // inside the product — there would be no account anywhere able to put it back.
  if (role === "super_admin") {
    const dropped = LOCKED_FOR_TOP_ROLE.filter((p) => !wanted.has(p));
    if (dropped.length > 0) {
      throw BadRequest(
        `A super admin cannot give up ${dropped.join(" or ")} — nobody would be able to grant it back`,
      );
    }
  }

  // 2. Nobody narrows their own role.
  //
  // Keyed on the actor's own role rather than on any notion of seniority,
  // because the mistake this prevents is specific: an administrator tidying the
  // matrix removes something from the role they are signed in as and loses the
  // ability to finish. Widening is fine — it takes nothing away from anyone.
  // Somebody else with the same permission can still make the change, which is
  // what keeps this a guard rather than a wall.
  if (role === actor.role) {
    const losing = current.filter((p) => !wanted.has(p));
    if (losing.length > 0) {
      throw BadRequest(
        `You cannot take ${losing.join(", ")} away from your own role — ask somebody else to`,
      );
    }
  }

  // 3. Only permissions that gate something.
  //
  // A row naming a string the catalogue does not define would sit in the table
  // looking like a grant and gate nothing at all. Refused rather than ignored:
  // the caller believes they granted something.
  const unknown = [...wanted].filter((p) => !isKnownPermission(p));
  if (unknown.length > 0) {
    throw BadRequest(`Not a permission this API gates on: ${unknown.join(", ")}`);
  }
}

export const permissionService = {
  /**
   * The whole matrix — to the screen that edits it, and to the page that simply
   * sets out what each role may do.
   *
   * Readable by anyone signed in. It was behind `permission:write` on the
   * grounds that the people who may look at the shape of the desk's trust are
   * the people who may change it, and that had a cost nobody had counted: the
   * Permissions page shows every user a role × capability table, could not read
   * this, and so rendered a HARD-CODED copy of the grants a fresh install starts
   * with. Every desk that edited its matrix had a page telling its staff
   * something untrue, and the mirror could not be fixed without an answer to
   * read — a second copy of the table is not a smaller leak than the table.
   *
   * What it actually discloses is which roles hold which permission names, all
   * of which the product already names on that page. It identifies no person and
   * grants nothing: a reader learns what an admin may do, not who the admins
   * are, and still gets a 403 from every route they do not hold.
   *
   * The WRITE is a different question and keeps its gate — see `setGrants`.
   *
   * `actor` stays on the signature: nothing here reads it, and a read that took
   * no principal would be a read nobody could later confine to one.
   */
  async matrix(actor: AuthUser): Promise<PermissionMatrix> {
    void actor;
    return {
      permissions: PERMISSIONS,
      grants: await currentGrants(),
      locked: LOCKED_FOR_TOP_ROLE,
    };
  },

  /**
   * Set one role's grants.
   *
   * Takes the whole list rather than a change, because that is the question the
   * screen is answering and because it makes two administrators editing at once
   * resolve to one of their answers rather than to a merge neither chose.
   */
  async setGrants(
    actor: AuthUser,
    input: { role: Role; permissions: string[] },
  ): Promise<PermissionMatrix> {
    if (!hasPermission(actor, PERMISSION_WRITE)) {
      throw Forbidden("You don't have permission to change what roles may do");
    }

    const wanted = new Set(input.permissions);
    const current = await grantsFor(input.role);
    assertSafe(actor, input.role, wanted, current);

    await replaceGrants({
      role: input.role,
      permissions: [...wanted],
      actorId: actor.id,
    });

    return {
      permissions: PERMISSIONS,
      grants: await currentGrants(),
      locked: LOCKED_FOR_TOP_ROLE,
    };
  },
};
