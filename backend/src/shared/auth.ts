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
  /** Team + department drive repository row-level scoping. */
  teamId: number | null;
  department: string | null;
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
  ],
  agent: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "user:read",
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
