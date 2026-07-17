"use client";

import Link from "next/link";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { slaColor } from "@/features/tickets/data";
import { useTickets } from "@/features/tickets/queries";

const COLS = "grid-cols-[86px_1fr_130px_96px_120px_110px]";

export function MyTickets() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useTickets();

  // Tickets assigned to the signed-in agent.
  const mine = (data?.tickets ?? [])
    .filter((t) => user != null && t.assignee === user.name)
    .slice(0, 4);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-3.5">
        <div className="text-[13.5px] font-semibold text-ink">
          {t("myTickets.title")}{" "}
          <span className="font-medium text-faint">
            · {t("myTickets.shown", { n: mine.length })}
          </span>
        </div>
        <Link href="/tickets" className="text-[12.5px] font-semibold text-brand">
          {t("myTickets.viewAll")}
        </Link>
      </div>

      <div
        className={`grid ${COLS} border-b border-[#eef1f5] bg-[#fafbfc] px-5 py-2.5 text-[12px] font-medium text-faint`}
      >
        <span>{t("col.id")}</span>
        <span>{t("col.subject")}</span>
        <span>{t("col.status")}</span>
        <span>{t("col.priority")}</span>
        <span>{t("col.requester")}</span>
        <span>{t("col.slaDue")}</span>
      </div>

      {isLoading ? <LoadingRow /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}
      {!isLoading && !isError && mine.length === 0 ? (
        <EmptyState message={t("myTickets.empty")} />
      ) : null}

      {mine.map((t, i) => (
        <Link
          key={t.id}
          href={`/tickets/${t.id}`}
          className={`grid ${COLS} items-center px-5 py-3 text-[13px] hover:bg-[#eff7f2] ${
            i < mine.length - 1 ? "border-b border-[#f1f4f8]" : ""
          }`}
        >
          <span className="font-mono text-[12px] font-medium text-muted">
            #{t.id}
          </span>
          <span className="truncate pr-3 font-medium text-ink">
            {t.subject}
          </span>
          <span>
            <StatusBadge status={t.status} />
          </span>
          <PriorityIndicator priority={t.priority} />
          <span className="text-[12.5px] text-[#475569]">{t.requester}</span>
          <span
            className="font-mono text-[12px] font-medium"
            style={{ color: slaColor[t.slaState] }}
          >
            {t.slaDue}
          </span>
        </Link>
      ))}
    </div>
  );
}
