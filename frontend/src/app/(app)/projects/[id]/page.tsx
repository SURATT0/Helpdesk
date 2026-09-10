"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderKanban, UserRound } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { MarkdownLite } from "@/components/ui/markdown-lite";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { useProject } from "@/features/projects/queries";
import { useTickets } from "@/features/tickets/queries";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * One project: what it is, and the work filed under it.
 *
 * Two requests rather than one endpoint returning both, deliberately. The
 * project 404s for anyone outside its tenant, and the ticket list is scoped
 * independently by the server — so a reader who should not see this project gets
 * nothing from either, and neither answer depends on the other having been
 * checked. A combined endpoint would make the ticket scope a consequence of the
 * project lookup rather than a rule of its own.
 */
export default function ProjectDetailPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const project = useProject(id);
  // Only asked for once the project is known to exist and be readable — an
  // out-of-scope id would answer with an empty list rather than a 404, and
  // showing "no tickets" for a project the reader may not see would be a
  // quieter, worse answer than "not found".
  const tickets = useTickets({ projectId: Number.isFinite(id) ? id : undefined });

  if (project.isLoading) {
    return (
      <>
        <Topbar titleKey="nav.projects" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <LoadingRow label={t("projects.loading")} />
        </main>
      </>
    );
  }

  if (project.isError || !project.data) {
    return (
      <>
        <Topbar titleKey="nav.projects" showSearch={false} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ErrorState
            message={t("projectDetail.notFound")}
            onRetry={() => router.push("/projects")}
          />
        </main>
      </>
    );
  }

  const p = project.data;
  const rows = tickets.data?.tickets ?? [];

  return (
    <>
      <Topbar titleKey="nav.projects" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <Link
          href="/projects"
          className="mb-4 inline-flex items-center gap-1.5 text-body text-muted hover:text-ink"
        >
          <ArrowLeft size={14} />
          {t("projectDetail.back")}
        </Link>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-hero font-bold tracking-heading text-ink">
            <FolderKanban size={22} className="flex-none text-faint" />
            {p.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted">
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={13} className="text-faint" />
              {t("projectDetail.owner")}:{" "}
              {p.owner ? (
                <span className="font-medium text-ink">
                  {p.owner.name}
                  {/* The away flag matters here specifically: it is why this
                      project's new tickets are landing on the backup instead. */}
                  {!p.owner.available ? ` — ${t("projects.away")}` : ""}
                </span>
              ) : (
                t("projects.noOwner")
              )}
            </span>
            {p.backupOwner ? (
              <span>
                {t("projectDetail.backup")}:{" "}
                <span className="font-medium text-ink">{p.backupOwner.name}</span>
              </span>
            ) : null}
            <span>
              {t("projectDetail.members", { count: p.members })}
            </span>
          </div>
        </header>

        <section className="mb-6 rounded-panel border border-line bg-panel p-4 sm:p-5">
          <h2 className="mb-3 text-section font-semibold text-ink">
            {t("projectDetail.about")}
          </h2>
          {p.description ? (
            <MarkdownLite text={p.description} />
          ) : (
            // Not an error and not an empty state with a call to action: a
            // project is a perfectly valid routing target with nothing written
            // about it, and every project that predates the field has none.
            <p className="text-body italic leading-relaxed text-faint">
              {t("projectDetail.noDescription")}
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-section font-semibold text-ink">
            {t("projectDetail.tickets", { count: rows.length })}
          </h2>

          <div className="overflow-hidden rounded-lg border border-line bg-panel">
            {tickets.isLoading ? <LoadingRow /> : null}
            {tickets.isError ? (
              <ErrorState onRetry={() => tickets.refetch()} />
            ) : null}
            {!tickets.isLoading && !tickets.isError && rows.length === 0 ? (
              <EmptyState message={t("projectDetail.noTickets")} />
            ) : null}

            {rows.map((ticket, i) => (
              <Link
                key={ticket.id}
                href={`/tickets/${ticket.id}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 hover:bg-app",
                  i < rows.length - 1 && "border-b border-rule",
                )}
              >
                <span className="w-[70px] flex-none text-body font-medium text-faint">
                  #{ticket.id}
                </span>
                <span className="min-w-0 flex-1 truncate text-control text-ink">
                  {ticket.subject}
                </span>
                <PriorityIndicator priority={ticket.priority} />
                <StatusBadge status={ticket.displayStatus} />
                <span className="hidden w-[110px] flex-none text-right text-body text-muted sm:block">
                  {new Date(ticket.createdAt).toLocaleDateString(
                    lang === "th" ? "th-TH" : "en-US",
                    { month: "short", day: "numeric" },
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
