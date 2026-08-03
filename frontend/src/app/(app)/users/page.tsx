"use client";

import * as React from "react";
import { Info, Users as UsersIcon } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { toneForName } from "@/features/tickets/data";
import { useAuth } from "@/features/auth/context";
import { useProjects } from "@/features/projects/queries";
import { useUpdateUser, useUsers } from "@/features/users/queries";
import { AvailabilityToggle } from "@/features/users/components/availability-toggle";
import { HandoverQueueModal } from "@/features/users/components/handover-queue-modal";
import { ProjectSelect } from "@/features/users/components/project-select";
import { useI18n } from "@/features/i18n/context";
import type { User, UserRole } from "@/features/users/schemas";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<UserRole, { fg: string; bg: string }> = {
  admin: { fg: "#6d28d9", bg: "#ede9fe" },
  manager: { fg: "#0369a1", bg: "#e0f2fe" },
  agent: { fg: "#15803d", bg: "#dcfce7" },
  requester: { fg: "#475569", bg: "#f1f5f9" },
};

const COLS =
  "grid-cols-[1.2fr_1.5fr_110px_140px_170px_120px_120px_130px]";

const formatDate = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { user: me } = useAuth();
  const { data: users = [], isLoading, isError, refetch } = useUsers();
  const update = useUpdateUser();

  // Mirrors the server's user:write grant. The API is the real gate; this only
  // avoids rendering controls that would be refused.
  const canEdit = me?.role === "admin" || me?.role === "manager";
  // Handing over a whole queue needs ticket:assign — managers and admins only,
  // unlike single-ticket assignment which any agent may do.
  const canHandover = canEdit;
  const [handoverFor, setHandoverFor] = React.useState<User | null>(null);
  // Projects are only needed for the editable picker, and requesters/agents
  // cannot write anyway — so don't fetch them for a read-only view.
  const { data: projectData } = useProjects({ enabled: canEdit });
  const projects = projectData?.projects ?? [];
  const pendingId = update.isPending ? update.variables?.id : undefined;

  return (
    <>
      <Topbar titleKey="nav.users" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="mb-4 flex max-w-[70ch] items-start gap-2 text-[12.5px] leading-relaxed text-[#475569]">
          <Info size={14} className="mt-[2px] flex-none text-faint" />
          {t("users.explainer")}
        </p>
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="overflow-x-auto">
            <div className="min-w-[1000px]">
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
            <span>{t("users.col.project")}</span>
            <span>{t("users.col.routing")}</span>
            <span>{t("users.col.joined")}</span>
            <span>{t("users.col.queue")}</span>
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

                <span className="pr-3">
                  {canEdit ? (
                    <ProjectSelect
                      value={u.project?.id ?? null}
                      projects={projects}
                      disabled={pendingId === u.id}
                      ariaLabel={`${t("users.col.project")} — ${u.name}`}
                      onChange={(projectId) =>
                        update.mutate({ id: u.id, input: { projectId } })
                      }
                    />
                  ) : (
                    <span className="truncate text-[12.5px] text-[#475569]">
                      {u.project?.name ?? "—"}
                    </span>
                  )}
                </span>

                <span>
                  <AvailabilityToggle
                    available={u.availableForAssignment}
                    canEdit={canEdit}
                    pending={pendingId === u.id}
                    ariaLabel={`${t("users.col.routing")} — ${u.name}`}
                    onChange={(availableForAssignment) =>
                      update.mutate({
                        id: u.id,
                        input: { availableForAssignment },
                      })
                    }
                  />
                </span>

                <span className="text-[12.5px] text-faint">
                  {formatDate(u.createdAt, lang)}
                </span>

                <span>
                  {/* Requesters raise tickets, they never hold a queue. */}
                  {canHandover && u.role !== "requester" ? (
                    <button
                      type="button"
                      onClick={() => setHandoverFor(u)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-[#475569] hover:bg-app"
                    >
                      <UsersIcon size={12} strokeWidth={2} />
                      {t("users.handover")}
                    </button>
                  ) : (
                    <span className="text-[12.5px] text-faint">—</span>
                  )}
                </span>
              </div>
            );
          })}
            </div>
          </div>
        </div>
      </main>

      {handoverFor ? (
        <HandoverQueueModal
          from={handoverFor}
          candidates={users}
          onClose={() => setHandoverFor(null)}
        />
      ) : null}
    </>
  );
}
