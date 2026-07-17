"use client";

import { Skeleton, ErrorState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { useDashboardSummary } from "../queries";

export function StatCards() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-line bg-panel">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const s = data.stats;
  // Only real, backed figures — no fabricated trend deltas (the API has no
  // period-over-period comparison to derive them from).
  const cards: { label: string; value: string; sub?: string }[] = [
    {
      label: t("dashboard.stat.total"),
      value: s.totalTickets.toLocaleString(),
    },
    {
      label: t("dashboard.stat.open"),
      value: String(s.openTickets),
      sub: t("dashboard.stat.unassigned", { n: s.unassigned }),
    },
    {
      label: t("dashboard.stat.closedWeek"),
      value: String(s.closedThisWeek),
      sub: t("dashboard.stat.avgRes", { n: s.avgResolutionHours }),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-line bg-panel px-[18px] py-4"
        >
          <div className="text-[12.5px] font-medium text-muted">{c.label}</div>
          <div className="mt-1.5 text-[26px] font-bold text-ink">{c.value}</div>
          {c.sub ? (
            <div className="mt-0.5 text-[11.5px] text-faint">{c.sub}</div>
          ) : null}
        </div>
      ))}

      {/* SLA at risk — accent card */}
      <div className="relative overflow-hidden rounded-lg border border-[#fde0c2] px-[18px] py-4">
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(135deg,#fff7ed 0%,#fff 55%)" }}
        />
        <div className="relative">
          <div className="text-[12.5px] font-medium text-[#9a5b13]">
            {t("dashboard.stat.slaRisk")}
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-[26px] font-bold text-[#b45309]">
              {s.slaAtRisk}
            </span>
            <span className="text-[12px] font-semibold text-[#b45309]">
              {t("dashboard.stat.breach1h", { n: s.slaBreachUnder1h })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
