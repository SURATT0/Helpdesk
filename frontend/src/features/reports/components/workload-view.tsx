"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { toneForName } from "@/features/tickets/data";
import { formatDuration } from "@/features/tickets/duration";
import { maySeeTeamWorkload } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { downloadCsv, workloadToCsv } from "../export";
import { useAgentWorkload } from "../queries";

const ROW = "grid-cols-[1fr_120px_120px]";
// 240px of fixed columns + 40px of row padding, leaving ~160px for the name.
const ROW_MIN_WIDTH = 440;

/**
 * Throughput per agent — the one screen that compares people, and therefore the
 * one screen that is gated.
 *
 * Two things guard it, and only the first is load-bearing: the API refuses
 * `/reports/workload/agents` with a 403 to anyone but a super admin, and this
 * component redirects rather than render. The redirect exists so a stale
 * bookmark lands somewhere useful instead of on an empty page — not to keep the
 * data safe, which is the server's job.
 *
 * The denial is deliberately quiet about what was refused. It sends the reader
 * to Reports with a short line and no description of the missing page: telling
 * someone precisely which report they may not read is itself a disclosure, and
 * an agent has no reason to learn that a table ranking them exists.
 */
export function WorkloadView() {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const allowed = maySeeTeamWorkload(user?.role);
  const { data, isLoading, isError, refetch } = useAgentWorkload();

  React.useEffect(() => {
    // `user` is null while the session is still loading; redirecting then would
    // bounce a super admin off their own page before the session arrives.
    if (user && !allowed) router.replace("/reports?denied=1");
  }, [user, allowed, router]);

  // Render nothing at all while unauthorised or still deciding — no skeleton, no
  // grey box, nothing that flashes and then disappears.
  if (!user || !allowed) return null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-[220px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <ErrorState message={t("report.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const units = {
    d: t("closedLog.unit.d"),
    h: t("closedLog.unit.h"),
    m: t("closedLog.unit.m"),
  };
  const hours = (n: number) => formatDuration(n * 3_600_000, units);

  function exportCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`deskly-workload-${stamp}.csv`, workloadToCsv(data ?? []));
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <div>
            <div className="text-lead font-semibold text-ink">
              {t("report.byAgent.title")}
            </div>
            <div className="text-caption text-faint">
              {t("report.byAgent.sub")}
            </div>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={data.length === 0}
            className="inline-flex flex-none items-center gap-1.5 rounded-md border border-line bg-white px-3 py-[7px] text-body font-semibold text-subtle hover:bg-app disabled:opacity-50"
          >
            <Download size={13} strokeWidth={2} />
            {t("report.export")}
          </button>
        </div>

        {data.length === 0 ? (
          <div className="px-5 py-6 text-center text-body text-faint">
            {t("report.sectionEmpty")}
          </div>
        ) : (
          <TableScroll minWidth={ROW_MIN_WIDTH}>
            <div
              className={`grid ${ROW} border-b border-hairline bg-wash px-5 py-2.5 text-caption font-semibold text-faint`}
            >
              <span>{t("report.col.agent")}</span>
              <span>{t("report.col.resolved")}</span>
              <span>{t("report.col.avgRes")}</span>
            </div>
            {data.map((r, i) => (
              <div
                key={r.agentId}
                data-agent-row={r.agentId}
                className={cn(
                  `grid ${ROW} items-center px-5 py-2.5 text-body`,
                  i < data.length - 1 && "border-b border-rule",
                )}
              >
                <span className="flex items-center gap-2 truncate text-ink">
                  <Avatar name={r.agent} tone={toneForName(r.agent)} size={22} />
                  {r.agent}
                  {r.agentId === user.id ? (
                    <span className="text-faint">· {t("filter.you")}</span>
                  ) : null}
                </span>
                <span className="font-mono text-dense font-medium text-subtle">
                  {r.handled}
                </span>
                <span className="font-mono text-dense font-medium text-subtle">
                  {hours(r.avgHandlingHours)}
                </span>
              </div>
            ))}
          </TableScroll>
        )}
      </div>
      <div className="text-caption text-faint">
        {t("report.workload.note")}
      </div>
    </div>
  );
}
