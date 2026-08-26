"use client";

import { Info, ShieldAlert } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUsers } from "@/features/users/queries";
import { cn } from "@/lib/utils";
import { useProjects, useUpdateProject } from "../queries";
import type { Project, ProjectOwner } from "../schemas";
import { NewProjectRow } from "./new-project-row";
import { OwnerSelect } from "./owner-select";

const COLS = "grid-cols-[1.3fr_1fr_1fr_110px]";

/** Where a project's next ticket actually lands, mirroring resolveRoutedAssignee. */
function routesTo(project: Project): {
  name: string | null;
  viaBackup: boolean;
} {
  const available = (o: ProjectOwner) => o != null && o.available;
  if (available(project.owner)) {
    return { name: project.owner!.name, viaBackup: false };
  }
  if (available(project.backupOwner)) {
    return { name: project.backupOwner!.name, viaBackup: true };
  }
  return { name: null, viaBackup: false };
}

/**
 * One owner slot — a picker for someone who may change it, the name as plain text
 * for someone who may only read it.
 *
 * The two grants are split: `project:read` reaches admin, `project:write` stops at
 * super_admin. So there IS now a viewer who can reach this cell without being able
 * to act on it, and a disabled picker would be the wrong rendering for them — it
 * reads as "temporarily unavailable" rather than "not yours to change". `disabled`
 * stays for the moment a save is in flight, which is a different thing.
 */
function OwnerCell({
  owner,
  ariaLabel,
  users,
  saving,
  canWrite,
  onChange,
}: {
  owner: ProjectOwner;
  ariaLabel: string;
  users: ReturnType<typeof useUsers>["data"];
  saving: boolean;
  canWrite: boolean;
  onChange: (id: number | null) => void;
}) {
  if (!canWrite) {
    return (
      <div className="truncate pr-3 text-[12.5px] text-[#475569]">
        {owner?.name ?? "—"}
      </div>
    );
  }
  return (
    <div className="pr-3">
      <OwnerSelect
        value={owner?.id ?? null}
        users={users ?? []}
        disabled={saving}
        ariaLabel={ariaLabel}
        onChange={onChange}
      />
    </div>
  );
}

export function ProjectsView() {
  const { t } = useI18n();
  const { user } = useAuth();
  // Mirrors the server's grants, which are split: project:read from admin up,
  // project:write only at the top. The API is the real gate; these keep a direct
  // visit from firing a request that would only come back 403, and show something
  // better than an error for it.
  const canRead = user != null && user.role !== "user";
  const canWrite = user?.role === "super_admin";
  const { data, isLoading, isError, refetch } = useProjects({ enabled: canRead });
  // Only the pickers need the directory, so a read-only viewer doesn't fetch it.
  const { data: users } = useUsers({ enabled: canWrite });
  const update = useUpdateProject();

  const projects = data?.projects ?? [];
  const savingId = update.isPending ? update.variables?.id : undefined;

  if (!canRead) {
    return (
      <>
        <Topbar titleKey="nav.projects" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-panel p-10 text-center">
            <ShieldAlert size={22} className="text-faint" />
            <div className="text-[13.5px] font-semibold text-ink">
              {t("projects.forbidden")}
            </div>
            <div className="max-w-[46ch] text-[12.5px] text-[#475569]">
              {t("projects.forbiddenNote")}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar titleKey="nav.projects" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="flex max-w-[62ch] items-start gap-2 text-[12.5px] leading-relaxed text-[#475569]">
            <Info size={14} className="mt-[2px] flex-none text-faint" />
            {t("projects.explainer")}
          </p>
          {canWrite ? <NewProjectRow /> : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <TableScroll minWidth={760}>
              <div
                className={cn(
                  "grid items-center border-b border-[#eef1f5] bg-[#fafbfc] px-4 py-2.5 text-[11.5px] font-semibold tracking-[0.02em] text-faint",
                  COLS,
                )}
              >
                <span>{t("projects.col.name")}</span>
                <span>{t("projects.col.owner")}</span>
                <span>{t("projects.col.backup")}</span>
                <span>{t("projects.col.members")}</span>
              </div>

              {isLoading ? <LoadingRow label={t("projects.loading")} /> : null}
              {isError ? (
                <ErrorState
                  message={t("projects.loadError")}
                  onRetry={() => refetch()}
                />
              ) : null}
              {!isLoading && !isError && projects.length === 0 ? (
                <EmptyState message={t("projects.empty")} />
              ) : null}

              {projects.map((p, i) => {
                const target = routesTo(p);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "grid items-center px-4 py-3 text-[13px]",
                      COLS,
                      i < projects.length - 1 && "border-b border-[#f1f4f8]",
                    )}
                  >
                    <span className="pr-3">
                      <span className="block truncate font-medium text-ink">
                        {p.name}
                      </span>
                      {/* The whole point of the feature, stated per row: who the
                          next ticket actually lands on. */}
                      <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                        {target.name == null
                          ? t("projects.routesToQueue")
                          : target.viaBackup
                            ? t("projects.routesToBackup", { name: target.name })
                            : t("projects.routesTo", { name: target.name })}
                      </span>
                    </span>

                    <OwnerCell
                      owner={p.owner}
                      ariaLabel={t("projects.col.owner")}
                      users={users}
                      saving={savingId === p.id}
                      canWrite={canWrite}
                      onChange={(ownerId) =>
                        update.mutate({ id: p.id, input: { ownerId } })
                      }
                    />

                    <OwnerCell
                      owner={p.backupOwner}
                      ariaLabel={t("projects.col.backup")}
                      users={users}
                      saving={savingId === p.id}
                      canWrite={canWrite}
                      onChange={(backupOwnerId) =>
                        update.mutate({ id: p.id, input: { backupOwnerId } })
                      }
                    />

                    <span className="text-[12.5px] text-[#475569]">
                      {p.members}
                    </span>
                  </div>
                );
              })}
          </TableScroll>
        </div>

        {update.isError ? (
          <p className="mt-3 text-[12.5px] text-[#dc2626]">
            {t("projects.saveError")}
          </p>
        ) : null}
      </main>
    </>
  );
}
