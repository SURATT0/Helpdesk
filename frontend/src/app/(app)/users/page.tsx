"use client";

import { Topbar } from "@/components/layout/topbar";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { toneForName } from "@/features/tickets/data";
import { useUsers } from "@/features/users/queries";
import { useI18n } from "@/features/i18n/context";
import type { UserRole } from "@/features/users/schemas";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<UserRole, { fg: string; bg: string }> = {
  admin: { fg: "#6d28d9", bg: "#ede9fe" },
  manager: { fg: "#0369a1", bg: "#e0f2fe" },
  agent: { fg: "#15803d", bg: "#dcfce7" },
  requester: { fg: "#475569", bg: "#f1f5f9" },
};

const COLS = "grid-cols-[1.3fr_1.6fr_120px_170px_130px]";

const formatDate = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { data: users = [], isLoading, isError, refetch } = useUsers();

  return (
    <>
      <Topbar titleKey="nav.users" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
          <div
            className={cn(
              "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
              COLS,
            )}
          >
            <span>{t("users.col.name")}</span>
            <span>{t("users.col.email")}</span>
            <span>{t("users.col.role")}</span>
            <span>{t("users.col.team")}</span>
            <span>{t("users.col.joined")}</span>
          </div>

          {isLoading ? <LoadingRow label={t("users.loading")} /> : null}
          {isError ? (
            <ErrorState message={t("users.loadError")} onRetry={() => refetch()} />
          ) : null}
          {!isLoading && !isError && users.length === 0 ? (
            <EmptyState message={t("users.empty")} />
          ) : null}

          {users.map((u, i) => {
            const role = ROLE_STYLE[u.role];
            return (
              <div
                key={u.id}
                className={cn(
                  "grid items-center px-4 py-3 text-[13px]",
                  COLS,
                  i < users.length - 1 && "border-b border-[#f1f4f8]",
                )}
              >
                <span className="flex items-center gap-2 font-medium text-ink">
                  <Avatar name={u.name} tone={toneForName(u.name)} size={24} />
                  <span className="truncate">{u.name}</span>
                </span>
                <span className="truncate text-[12.5px] text-[#475569]">
                  {u.email}
                </span>
                <span>
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
                    style={{ color: role.fg, background: role.bg }}
                  >
                    {t(`role.${u.role}`)}
                  </span>
                </span>
                <span className="truncate text-[12.5px] text-[#475569]">
                  {u.team?.name ?? "—"}
                </span>
                <span className="text-[12.5px] text-faint">
                  {formatDate(u.createdAt, lang)}
                </span>
              </div>
            );
          })}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
