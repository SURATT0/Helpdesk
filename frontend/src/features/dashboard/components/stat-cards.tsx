"use client";

import { Skeleton, ErrorState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { useDashboardSummary } from "../queries";

export function StatCards() {
  const { t, locale } = useI18n();
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
      // Explicit locale for the same reason as the CSV export: the default is
      // the browser's, not the app's.
      value: s.totalTickets.toLocaleString(locale),
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
          <div className="text-body font-medium text-muted">{c.label}</div>
          <div className="mt-1.5 text-figure font-bold text-ink">{c.value}</div>
          {c.sub ? (
            <div className="mt-0.5 text-caption text-faint">{c.sub}</div>
          ) : null}
        </div>
      ))}

      {/* SLA — accent card, two counts that do not overlap.

          One figure with the other tucked into a sub-line would have made this
          card answer a question it cannot: which of the two is the headline
          depends on the day. Missing three is worse than three about to miss,
          but a bold 0 over "already missed" reads as "nothing to do" on a
          morning when four are an hour from breaching. Side by side, each
          labelled, the reader decides. */}
      <div className="relative overflow-hidden rounded-lg border border-[#fde0c2] px-[18px] py-4">
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(135deg,#fff7ed 0%,#fff 55%)" }}
        />
        <div className="relative">
          <div className="text-body font-medium text-[#9a5b13]">
            {t("dashboard.stat.slaRisk")}
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {/* Danger, not warn: this one is a deadline that has already gone
                past, and it wore the same amber as the tickets still in front
                of theirs. */}
            <span className="flex items-baseline gap-1.5">
              <span className="text-figure font-bold text-danger-ink">
                {s.slaBreached}
              </span>
              <span className="text-dense font-semibold text-danger-ink">
                {t("dashboard.stat.slaBreached")}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-figure font-bold text-warn">
                {s.slaDueSoon}
              </span>
              <span className="text-dense font-semibold text-warn">
                {t("dashboard.stat.slaDueSoon")}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
