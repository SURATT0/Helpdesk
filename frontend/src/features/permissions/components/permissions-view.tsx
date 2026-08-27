"use client";

import { Check, Minus, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import type { Role } from "@/features/auth/schemas";
import { ROLES, rolesHolding } from "@/lib/permissions";

/**
 * A capability → the permission(s) a route asks for before allowing it.
 *
 * Each row names the grant and the roles are DERIVED from it, so this table can
 * only ever say what `ROLE_PERMISSIONS` says. It used to carry a hand-written
 * role list per row, and three of them had drifted from the API: assignment was
 * shown as super_admin-only although `PATCH /tickets/:id/assignee` and
 * `/priority` both ask for `ticket:write`; and writing the knowledge base and
 * deleting a ticket were enforced on routes but missing from the page entirely.
 *
 * Ordered by who holds it — everyone, then the desk, then the top tier — since
 * a reader scans down their own column.
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
  // Held by no role explicitly, so only super_admin's `*` satisfies it: closing
  // is the normal end of a ticket's life and this is the escape hatch for a row
  // that should never have existed.
  { key: "cap.deleteTicket", perms: ["ticket:delete"] },
];

/**
 * Row-level scope enforced in the repository WHERE clause.
 *
 * Note this is keyed on role but the top row depends on more than the role: a
 * super_admin reaches every customer only when they have no customer of their own.
 * The copy for that row says so, since the table cannot.
 */
const SCOPE: { role: Role; key: string }[] = [
  { role: "user", key: "scope.user" },
  { role: "admin", key: "scope.admin" },
  { role: "super_admin", key: "scope.super_admin" },
];

export function PermissionsView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const myRole = user?.role;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 p-4 sm:p-6">
      {/* Your access */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent-soft text-brand-hover">
            <Shield size={18} strokeWidth={2} />
          </span>
          <div>
            <div className="text-section font-semibold text-ink">
              {t("perm.yourAccess")}
            </div>
            <div className="mt-0.5 text-body text-muted">
              {myRole
                ? t("perm.yourRole", { role: t(`role.${myRole}`) })
                : "—"}
            </div>
          </div>
          {myRole ? (
            <span className="ml-auto rounded-full bg-accent-soft px-3 py-1 text-body font-semibold text-brand-hover">
              {t(`role.${myRole}`)}
            </span>
          ) : null}
        </div>
      </Card>

      {/* Permission matrix */}
      <Card className="p-5">
        <div className="mb-3.5">
          <div className="text-section font-semibold text-ink">
            {t("perm.matrixTitle")}
          </div>
          <div className="mt-0.5 text-dense text-faint">
            {t("perm.matrixNote")}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-3 text-left font-semibold text-muted">
                  {t("perm.capability")}
                </th>
                {ROLES.map((r) => (
                  <th
                    key={r}
                    className={cn(
                      "px-2 py-2 text-center font-semibold",
                      r === myRole
                        ? "text-brand-hover"
                        : "text-muted",
                    )}
                  >
                    {t(`role.${r}`)}
                    {r === myRole ? (
                      <span className="ml-1 text-counter font-bold uppercase tracking-wide text-accent">
                        {t("perm.you")}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => {
                const held = rolesHolding(cap.perms);
                return (
                <tr
                  key={cap.key}
                  data-cap={cap.key}
                  className="border-b border-rule"
                >
                  <td className="py-2.5 pr-3 text-ink">{t(cap.key)}</td>
                  {ROLES.map((r) => {
                    const allowed = held.includes(r);
                    return (
                      <td
                        key={r}
                        data-role={r}
                        data-allowed={allowed}
                        className={cn(
                          "px-2 py-2.5 text-center",
                          r === myRole && "bg-accent-wash",
                        )}
                      >
                        {/* Named, because a tick with no accessible name is
                            silence: the whole answer this table gives is which
                            cell is ticked. */}
                        {allowed ? (
                          <Check
                            size={15}
                            strokeWidth={2.5}
                            role="img"
                            aria-label={t("perm.allowed")}
                            className="mx-auto text-accent"
                          />
                        ) : (
                          <Minus
                            size={14}
                            strokeWidth={2}
                            role="img"
                            aria-label={t("perm.denied")}
                            className="mx-auto text-dim"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-caption text-faint">{t("perm.userScopeNote")}</p>
      </Card>

      {/* Row-level ticket visibility */}
      <Card className="p-5">
        <div className="mb-3.5">
          <div className="text-section font-semibold text-ink">
            {t("perm.scopeTitle")}
          </div>
          <div className="mt-0.5 text-dense text-faint">
            {t("perm.scopeNote")}
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {SCOPE.map((s) => (
            <li
              key={s.role}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3.5 py-2.5",
                s.role === myRole
                  ? "border-accent-line bg-accent-wash"
                  : "border-line bg-white",
              )}
            >
              <span className="w-24 flex-none text-body font-semibold text-ink">
                {t(`role.${s.role}`)}
              </span>
              <span className="text-body text-muted">{t(s.key)}</span>
            </li>
          ))}
        </ul>
        {/* The table above is headed "ticket visibility", which undersells it:
            the same clause is what the history, the dashboard and the reports
            count through. Worth saying, since a reader looking at an empty
            dashboard otherwise has no way to tell scoping from no data. */}
        <p className="mt-3 text-caption leading-relaxed text-faint">
          {t("perm.scopeReach")}
        </p>
      </Card>
    </div>
  );
}
