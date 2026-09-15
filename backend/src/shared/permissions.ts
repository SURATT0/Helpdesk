import type { Role } from "./domain";

/**
 * Every permission the API gates on, and what each one actually lets a person
 * do.
 *
 * This is a CATALOGUE, not a grant table. Which role holds which permission now
 * lives in `role_permissions` and is editable; what the strings MEAN is code,
 * because each one corresponds to a `requirePermission` on a route or a
 * `hasPermission` in a service, and a row in a table cannot create a new gate.
 * The matrix screen renders this list, so a permission with no entry here is one
 * nobody can grant — which is the right failure: an ungrantable gate is visible,
 * a grantable string that gates nothing is not.
 *
 * `description` is what the person editing the matrix reads. It says what the
 * holder can DO, not which endpoint it guards: the reader is deciding whether an
 * agent should be able to hand a queue over, not whether they should be able to
 * PATCH /tickets/:id/assignee.
 */

export type PermissionGroup =
  | "tickets"
  | "knowledge"
  | "people"
  | "structure"
  | "admin";

export type PermissionDef = {
  key: string;
  group: PermissionGroup;
  /** English, for a log and for a developer. The UI words its own from `key`. */
  description: string;
  /**
   * Whether this permission may ever be taken away from `super_admin`.
   *
   * Two of them may not, and for one reason: without `user:write` nobody can
   * change who holds a role, and without `permission:write` nobody can change
   * what a role may do. Removing either is the one edit this screen could make
   * that it could not then undo — the door locks from the inside and the key is
   * on the other side.
   */
  lockedForTopRole?: true;
};

export const PERMISSIONS: readonly PermissionDef[] = [
  // --- Working tickets -----------------------------------------------------
  { key: "ticket:read", group: "tickets", description: "See tickets within their scope" },
  { key: "ticket:create", group: "tickets", description: "Raise a ticket" },
  { key: "ticket:write", group: "tickets", description: "Work a ticket: reply, change status, priority and assignee" },
  { key: "ticket:assign", group: "tickets", description: "Hand a whole queue over from one person to another" },
  { key: "ticket:import", group: "tickets", description: "Import tickets from CSV and connected sources" },
  { key: "ticket:delete", group: "tickets", description: "Delete a ticket outright, rather than closing it" },

  // --- Knowledge -----------------------------------------------------------
  { key: "kb:write", group: "knowledge", description: "Write and publish knowledge-base articles" },
  { key: "problem:read", group: "knowledge", description: "Browse the problem register" },
  { key: "problem:write", group: "knowledge", description: "Raise problems and link tickets to them" },
  { key: "asset:read", group: "knowledge", description: "Browse the asset register" },
  { key: "asset:write", group: "knowledge", description: "Add and edit assets" },

  // --- People --------------------------------------------------------------
  { key: "user:read", group: "people", description: "See the user directory" },
  {
    key: "user:write",
    group: "people",
    // Creating one is platform-wide on top of this permission, the same way
    // approving a registration is: it chooses the person's tenant, and an
    // account created into a customer its creator cannot reach is a row nobody
    // can list, open or rename. Said here because a permission cannot express
    // it — the same reason the two customer entries say it.
    description:
      "Change roles and deactivate accounts; creating one is platform staff only",
    lockedForTopRole: true,
  },

  // --- Structure -----------------------------------------------------------
  { key: "project:read", group: "structure", description: "See the routing table" },
  { key: "project:write", group: "structure", description: "Change who owns a routing project" },
  { key: "project:delete", group: "structure", description: "Delete a routing project" },
  // Both also require platform reach, which no permission string can express:
  // creating a tenant puts it outside every reach, so a creator who is not
  // platform-wide cannot see what they made. Granting it to a role that always
  // belongs to a customer therefore grants nothing usable — the description says
  // so, because the matrix is editable and this is not obvious from the key.
  {
    key: "customer:write",
    group: "structure",
    description: "Create and rename customers (also needs platform-wide reach)",
  },
  {
    key: "customer:archive",
    group: "structure",
    description: "Archive a customer (also needs platform-wide reach)",
  },
  { key: "category:write", group: "structure", description: "Add categories, and promote what people typed under Other" },

  // --- Administering the desk ----------------------------------------------
  { key: "audit:read", group: "admin", description: "Read the activity log" },
  { key: "settings:write", group: "admin", description: "Change the desk's notification policy" },
  { key: "comment:moderate", group: "admin", description: "Delete somebody else's message" },
  {
    key: "permission:write",
    group: "admin",
    description: "Change what each role may do",
    lockedForTopRole: true,
  },
] as const;

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function isKnownPermission(key: string): boolean {
  return BY_KEY.has(key);
}

/** The ones `super_admin` must keep, whatever the matrix is set to. */
export const LOCKED_FOR_TOP_ROLE: readonly string[] = PERMISSIONS.filter(
  (p) => p.lockedForTopRole,
).map((p) => p.key);

/**
 * The grants each role starts with — what the hard-coded table held the day
 * before this became editable.
 *
 * Used by the migration that fills `role_permissions`, and by the test that
 * proves the move changed nothing. After that it is history: the database is the
 * answer, and this constant must not be consulted at request time.
 *
 * `super_admin`'s `*` is EXPANDED here into every permission in the catalogue,
 * and that is a real behaviour change rather than a transcription. A wildcard
 * cannot be un-ticked — every box on the matrix would stay effectively on — so
 * the top role now holds an explicit list like everyone else. The cost is
 * stated where it lands: a permission added to the catalogue later does not
 * reach super_admin on its own any more, and `permissions.test.ts` fails until
 * someone decides who gets it.
 */
export const INITIAL_ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  super_admin: PERMISSION_KEYS,
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
    // Creating and renaming a customer. It was `role === "admin" || "super_admin"`
    // in customer.service before the grants became editable, so it is here: this
    // list is a transcription of what the hard-coded checks allowed, and leaving
    // it out would have been a silent demotion rather than a move.
    //
    // Note what it does NOT confer, which is why an admin holding it is safe:
    // reach is a separate axis, so an admin who creates a customer cannot see
    // into it, and `mayGrantReach` is platform-wide only, so they cannot grant
    // themselves the reach either.
    "customer:write",
  ],
  user: ["ticket:read", "ticket:create"],
};
