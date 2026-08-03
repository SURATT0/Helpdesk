"use client";

import { Check, Minus, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import type { Role } from "@/features/auth/schemas";

// Columns in ascending privilege. Kept in sync with the backend's
// ROLE_PERMISSIONS + repository row-scoping — this page documents what the API
// actually enforces (verified by the RBAC integration tests).
const ROLES: Role[] = ["requester", "agent", "manager", "admin"];

// A capability → the roles that hold it. Mirrors the enforced permission checks:
// ticket:write (reply/status/notes/assign), ticket:import, user:read, user:write.
const CAPABILITIES: { key: string; roles: Role[] }[] = [
  { key: "cap.viewTickets", roles: ["requester", "agent", "manager", "admin"] },
  { key: "cap.createTicket", roles: ["requester", "agent", "manager", "admin"] },
  { key: "cap.reply", roles: ["agent", "manager", "admin"] },
  { key: "cap.internalNote", roles: ["agent", "manager", "admin"] },
  { key: "cap.assign", roles: ["agent", "manager", "admin"] },
  { key: "cap.import", roles: ["agent", "manager", "admin"] },
  { key: "cap.viewUsers", roles: ["agent", "manager", "admin"] },
  { key: "cap.manageUsers", roles: ["manager", "admin"] },
  // Routing projects sit at manager level and up, read and write together.
  { key: "cap.routingProjects", roles: ["manager", "admin"] },
];

// Row-level scope enforced in the repository WHERE clause.
const SCOPE: { role: Role; key: string }[] = [
  { role: "requester", key: "scope.requester" },
  { role: "agent", key: "scope.agent" },
  { role: "manager", key: "scope.manager" },
  { role: "admin", key: "scope.admin" },
];

export function PermissionsView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const myRole = user?.role;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 p-6">
      {/* Your access */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[#e4f2ea] text-brand-hover">
            <Shield size={18} strokeWidth={2} />
          </span>
          <div>
            <div className="text-[14px] font-semibold text-ink">
              {t("perm.yourAccess")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              {myRole
                ? t("perm.yourRole", { role: t(`role.${myRole}`) })
                : "—"}
            </div>
          </div>
          {myRole ? (
            <span className="ml-auto rounded-full bg-[#e4f2ea] px-3 py-1 text-[12.5px] font-semibold text-brand-hover">
              {t(`role.${myRole}`)}
            </span>
          ) : null}
        </div>
      </Card>

      {/* Permission matrix */}
      <Card className="p-5">
        <div className="mb-3.5">
          <div className="text-[14px] font-semibold text-ink">
            {t("perm.matrixTitle")}
          </div>
          <div className="mt-0.5 text-[12px] text-faint">
            {t("perm.matrixNote")}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
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
                      <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-[#3f8f5e]">
                        {t("perm.you")}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.key} className="border-b border-[#f1f4f8]">
                  <td className="py-2.5 pr-3 text-ink">{t(cap.key)}</td>
                  {ROLES.map((r) => {
                    const allowed = cap.roles.includes(r);
                    return (
                      <td
                        key={r}
                        className={cn(
                          "px-2 py-2.5 text-center",
                          r === myRole && "bg-[#f4faf6]",
                        )}
                      >
                        {allowed ? (
                          <Check
                            size={15}
                            strokeWidth={2.5}
                            className="mx-auto text-[#3f8f5e]"
                          />
                        ) : (
                          <Minus
                            size={14}
                            strokeWidth={2}
                            className="mx-auto text-[#cbd5e1]"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11.5px] text-faint">{t("perm.userScopeNote")}</p>
      </Card>

      {/* Row-level ticket visibility */}
      <Card className="p-5">
        <div className="mb-3.5">
          <div className="text-[14px] font-semibold text-ink">
            {t("perm.scopeTitle")}
          </div>
          <div className="mt-0.5 text-[12px] text-faint">
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
                  ? "border-[#b4dcc3] bg-[#f4faf6]"
                  : "border-line bg-white",
              )}
            >
              <span className="w-24 flex-none text-[12.5px] font-semibold text-ink">
                {t(`role.${s.role}`)}
              </span>
              <span className="text-[12.5px] text-muted">{t(s.key)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
