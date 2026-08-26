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
  /**
   * Tenant boundary for row-level scoping. A value pins the principal to that one
   * customer; null means they have no tenant of their own, which grants
   * platform-wide reach only in combination with the top role — see
   * `isPlatformWide`.
   */
  customerId: number | null;
  permissions: string[];
};

/**
 * May this principal see across every customer?
 *
 * The single source of truth for cross-tenant reach, deliberately one function
 * rather than a condition repeated in each scope builder: this is the predicate
 * that separates tenants, and five copies of it are five chances for one to drift.
 *
 * Reach needs BOTH halves. The top role alone is not enough — a super_admin who
 * belongs to a customer (what used to be a manager) is confined to it. No tenant
 * alone is not enough either — a customer-less admin is not thereby promoted to
 * every tenant; the scope builders fall back to showing them only their own
 * tickets, which is how a customer-less agent was always treated.
 */
export function isPlatformWide(user: {
  role: Role;
  customerId: number | null;
}): boolean {
  return user.role === "super_admin" && user.customerId == null;
}

/**
 * Coarse permission grants per role. `*` = all (admin). Reads are gated by
 * row-level scoping rather than a permission (everyone may read what their
 * scope allows), so `ticket:read` is granted broadly; writes are permissioned.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  // Everything an admin can do, plus managing the admins themselves. `*` rather
  // than an enumerated list because this is the top of the hierarchy: a new
  // permission should reach it without an edit here, and forgetting to add one
  // would silently leave the top role unable to administer something.
  //
  // Note this DOES widen what a former manager may do — granting roles included.
  // That follows from merging manager into this role: two ranks became one, so
  // they hold one rank's powers. Reach is the axis that still separates them, and
  // it lives on customerId, not here.
  super_admin: ["*"],
  // Exactly what the old agent role held — this tier is the rename, not a
  // promotion. Assigning a single ticket already rides on ticket:write; handing
  // over a whole queue (ticket:assign), reading reports, the audit trail, user
  // management and routing projects all stay above this line, as they were.
  admin: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "user:read",
    // Assets and problems are day-to-day desk work: an admin maintains the
    // registry and raises or links problems while working cases.
    "asset:write",
    "problem:write",
    // Reading a whole REGISTER is desk work too, and needs saying separately from
    // the write grants above: browsing every asset (with its owner's name and
    // email) or every open investigation is the desk's view of the customer, not
    // a requester's. What a requester legitimately needs about their own ticket
    // already rides on the ticket — `affectedAssets` inline, and the linked
    // problem through `problemScopeWhere`, which reaches it via their ticket.
    "asset:read",
    "problem:read",
    // Reading the routing table and the activity log. Both were super_admin-only,
    // which left an admin working cases unable to see where their queue's work
    // comes from or what happened to a ticket before they picked it up. The
    // WRITES stay above this line: `project:write` (who owns a routing project)
    // is management structure, and there is no audit write at all.
    "project:read",
    "audit:read",
  ],
  // Deliberately narrow: raise a ticket, follow it, read the knowledge base.
  // Reading the KB needs no permission — it is open to any authenticated user —
  // so there is nothing to grant for it here.
  user: ["ticket:read", "ticket:create"],
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
