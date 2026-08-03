import type { Role } from "./domain";

/**
 * The authenticated principal carried on the access-token JWT and attached to
 * `req.user` by the requireAuth middleware. Permissions are derived from the
 * role here; finer-grained permission checks land with the RBAC milestone.
 */
export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** Team + department are retained for routing/display. */
  teamId: number | null;
  department: string | null;
  /** Tenant boundary for row-level scoping. null = platform-wide (admin). */
  customerId: number | null;
  permissions: string[];
};

/**
 * Coarse permission grants per role. `*` = all (admin). Reads are gated by
 * row-level scoping rather than a permission (everyone may read what their
 * scope allows), so `ticket:read` is granted broadly; writes are permissioned.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  admin: ["*"],
  manager: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "ticket:assign",
    "report:read",
    "user:read",
    // Read the audit trail. Management/compliance work, not desk work — agents
    // are deliberately excluded. Which rows a manager sees is scoped to their
    // own customer in the audit repository.
    "audit:read",
    // Manage users — but only within their own department (scoped in the
    // user repository); admins manage everyone.
    "user:write",
    "asset:write",
    "problem:write",
    // Routing projects are management structure, not desk work: who owns a
    // customer's incoming tickets, and who covers when they are away. Read and
    // write are both held from manager up, so the two never disagree — an agent
    // that could read the list but never act on it only invited the question of
    // why the page was there.
    "project:read",
    "project:write",
  ],
  agent: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "user:read",
    // Agents maintain the asset registry and raise/link problems — both are
    // day-to-day desk work, not administration.
    "asset:write",
    "problem:write",
  ],
  requester: ["ticket:read", "ticket:create"],
};

export function permissionsFor(role: Role): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Whether the principal holds a permission (admins hold `*`). */
export function hasPermission(user: AuthUser, permission: string): boolean {
  return (
    user.permissions.includes("*") || user.permissions.includes(permission)
  );
}
