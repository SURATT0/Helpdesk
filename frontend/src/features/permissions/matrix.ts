import type { Role } from "@/lib/domain";
import { ROLES } from "@/lib/permissions";

/**
 * A capability → the permission(s) a route asks for before allowing it.
 *
 * Each row names the grant and the roles are DERIVED from it against the live
 * matrix, so this table can only ever say what the API would actually answer. It
 * used to carry a hand-written role list per row, and three of them had drifted
 * from the API: assignment was shown as super_admin-only although
 * `PATCH /tickets/:id/assignee` and `/priority` both ask for `ticket:write`; and
 * writing the knowledge base and deleting a ticket were enforced on routes but
 * missing from the page entirely.
 *
 * Ordered by who holds it — everyone, then the desk, then the top tier — since
 * a reader scans down their own column. That is the ORDER the starting matrix
 * produces; a desk that has moved a grant will see a row out of order rather
 * than a row that lies, which is the right way round.
 */
export const CAPABILITIES: { key: string; perms: readonly string[] }[] = [
  { key: "cap.viewTickets", perms: ["ticket:read"] },
  { key: "cap.createTicket", perms: ["ticket:create"] },
  { key: "cap.reply", perms: ["ticket:write"] },
  { key: "cap.internalNote", perms: ["ticket:write"] },
  // Assigning ONE ticket and setting its priority both ride on ticket:write, so
  // this reaches an admin. Handing over a whole queue is the row below.
  { key: "cap.assign", perms: ["ticket:write"] },
  { key: "cap.import", perms: ["ticket:import"] },
  { key: "cap.viewUsers", perms: ["user:read"] },
  // Browsing a whole register is the desk's view of the customer; a requester
  // still sees the assets on their own ticket and the problem it is linked to,
  // which reach them through the ticket rather than here.
  { key: "cap.registers", perms: ["asset:read", "problem:read"] },
  // The people who work the cases are the ones who know what the fix was, so
  // kb:write reaches an admin — and an unpublished draft is visible to whoever
  // may edit it.
  { key: "cap.kb", perms: ["kb:write"] },
  // project:read and audit:read reach admin; project:write does not. Separate
  // rows, because one row saying "view & manage" can only be right about one.
  { key: "cap.viewRoutingProjects", perms: ["project:read"] },
  { key: "cap.audit", perms: ["audit:read"] },
  { key: "cap.handover", perms: ["ticket:assign"] },
  { key: "cap.manageUsers", perms: ["user:write"] },
  { key: "cap.routingProjects", perms: ["project:write"] },
  // The starting matrix gives this to super_admin alone: closing is the normal
  // end of a ticket's life and this is the escape hatch for a row that should
  // never have existed.
  { key: "cap.deleteTicket", perms: ["ticket:delete"] },
  { key: "cap.deleteProject", perms: ["project:delete"] },
  // Configuring which events are mailed, how often, and when the SLA starts
  // warning. The starting matrix gives this to super_admin alone: it is the
  // desk's own policy rather than case work. WHICH tenant's policy a holder
  // reaches is the reach axis, not this one — see the scope table on the page.
  { key: "cap.notificationSettings", perms: ["settings:write"] },
];

/** Role → the permissions it holds, as the API's matrix endpoint sends it. */
export type Grants = Record<string, string[]>;

/**
 * Which roles hold ALL of these permissions, according to the live matrix.
 *
 * Every permission, not any: a row like "browse the asset & problem registers"
 * is only true for a role that can do both halves, and a role holding one of
 * them would otherwise get a tick for something it cannot finish.
 *
 * `*` is honoured because the server's own `hasPermission` honours it. Nothing
 * writes it into `role_permissions` today — the top role holds an expanded list
 * of every key instead — but a page that disagreed with the server about it
 * would put empty cells beside a role that can do everything.
 *
 * A role absent from `grants` holds nothing, which is the safe direction: an
 * unticked cell understates what somebody can do, and the API is the gate.
 */
export function rolesHolding(
  perms: readonly string[],
  grants: Grants,
): Role[] {
  return ROLES.filter((role) => {
    const held = grants[role] ?? [];
    return perms.every((p) => held.includes("*") || held.includes(p));
  });
}
