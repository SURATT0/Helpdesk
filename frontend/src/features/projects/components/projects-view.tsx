"use client";

import { Info } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
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

function OwnerCell({
  owner,
  canEdit,
  ariaLabel,
  users,
  saving,
  onChange,
}: {
  owner: ProjectOwner;
  canEdit: boolean;
  ariaLabel: string;
  users: ReturnType<typeof useUsers>["data"];
  saving: boolean;
  onChange: (id: number | null) => void;
}) {
  const { t } = useI18n();

  if (canEdit) {
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

  if (!owner) return <span className="text-[12.5px] text-faint">—</span>;
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-[#475569]">
      <span className="truncate">{owner.name}</span>
      {!owner.available ? (
        <span className="flex-none rounded-full bg-status-pending-bg px-1.5 py-[1px] text-[10.5px] font-semibold text-status-pending-fg">
          {t("projects.away")}
        </span>
      ) : null}
    </span>
  );
}

export function ProjectsView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useProjects();
  const { data: users } = useUsers();
  const update = useUpdateProject();

  const projects = data?.projects ?? [];
  // Mirrors the server's project:write grant. The API is the real gate; this only
  // avoids offering a control that would be refused.
  const canEdit = user?.role === "admin" || user?.role === "manager";
  const savingId = update.isPending ? update.variables?.id : undefined;

  return (
    <>
      <Topbar titleKey="nav.projects" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="flex max-w-[62ch] items-start gap-2 text-[12.5px] leading-relaxed text-[#475569]">
            <Info size={14} className="mt-[2px] flex-none text-faint" />
            {t("projects.explainer")}
          </p>
          {canEdit ? <NewProjectRow /> : null}
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
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
                      canEdit={canEdit}
                      ariaLabel={t("projects.col.owner")}
                      users={users}
                      saving={savingId === p.id}
                      onChange={(ownerId) =>
                        update.mutate({ id: p.id, input: { ownerId } })
                      }
                    />

                    <OwnerCell
                      owner={p.backupOwner}
                      canEdit={canEdit}
                      ariaLabel={t("projects.col.backup")}
                      users={users}
                      saving={savingId === p.id}
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
            </div>
          </div>
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
