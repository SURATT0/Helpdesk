"use client";

import Link from "next/link";
import { StatusBadge, PriorityIndicator } from "@/components/ui/status-badge";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { SlaBadge } from "@/features/tickets/components/sla-badge";
import { useAssessSla } from "@/features/tickets/use-sla";
import { useTickets } from "@/features/tickets/queries";

const COLS = "grid-cols-[86px_1fr_130px_96px_120px_110px]";

// 542px of fixed columns + 40px of row padding, leaving ~180px for the subject —
// about what the same column gets in the full ticket table. Below this the
// columns scroll; they used to be clipped away instead, unreachably.
const MIN_WIDTH = 760;

export function MyTickets() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useTickets();
  const assess = useAssessSla();

  // Work in flight assigned to the signed-in agent. Terminal states are excluded
  // deliberately: the list is ordered by SLA due date, so closed tickets — whose
  // due dates are the oldest of all — would otherwise crowd out every live
  // ticket. Closed work has its own home in the ticket history log.
  const mine = (data?.tickets ?? [])
    .filter(
      (t) =>
        user != null &&
        t.assignee === user.name &&
        t.status !== "closed" &&
        t.status !== "resolved",
    )
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

      <TableScroll minWidth={MIN_WIDTH}>
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
            <SlaBadge sla={assess(t)} />
          </Link>
        ))}
      </TableScroll>
    </div>
  );
}
