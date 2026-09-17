"use client";

import { Check, Minus, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import type { Role } from "@/features/auth/schemas";
import { ROLES } from "@/lib/permissions";
import { CAPABILITIES, rolesHolding } from "../matrix";
import { usePermissionMatrix } from "../queries";

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

      <MatrixCard myRole={myRole} />

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

/**
 * What each role may do, read from the live matrix.
 *
 * It used to be derived from a hard-coded copy of the grants a fresh install
 * starts with, which is a table that describes no actual desk the moment anybody
 * edits their matrix — and the copy was already behind, showing `admin` without
 * `customer:write`. The rows are the same; where the ticks go is now the API's
 * answer rather than this file's memory of it.
 *
 * Its own card so the query's loading and error states are contained: "your
 * access" and the scope table below are answered by the session and must not
 * disappear while this is in flight.
 */
function MatrixCard({ myRole }: { myRole: Role | undefined }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = usePermissionMatrix();

  return (
    <Card className="p-5">
      <div className="mb-3.5">
        <div className="text-section font-semibold text-ink">
          {t("perm.matrixTitle")}
        </div>
        <div className="mt-0.5 text-dense text-faint">
          {t("perm.matrixNote")}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[420px]" />
      ) : isError || !data ? (
        // No fallback table. An out-of-date matrix is exactly what this card
        // stopped rendering, and putting one back on the error path would make
        // the failure invisible in the one direction that matters.
        <ErrorState message={t("perm.matrixError")} onRetry={() => refetch()} />
      ) : (
        <>
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
                const held = rolesHolding(cap.perms, data.grants);
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
        </>
      )}
    </Card>
  );
}
