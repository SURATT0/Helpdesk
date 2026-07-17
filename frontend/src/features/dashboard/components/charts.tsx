"use client";

import { Card } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { STATUS_CHART, PRIORITY_CHART, conicGradient } from "../data";
import { useDashboardSummary } from "../queries";

export function StatusBarChart() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  return (
    <Card className="px-5 py-[18px]">
      <div className="mb-4 text-[13.5px] font-semibold text-ink">
        {t("charts.byStatus")}
      </div>

      {isLoading ? <Skeleton className="h-[150px]" /> : null}
      {isError ? (
        <ErrorState message={t("charts.noData")} onRetry={() => refetch()} />
      ) : null}

      {data ? (
        <div className="flex h-[150px] items-end gap-6 px-1.5">
          {(() => {
            const max = Math.max(...data.byStatus.map((b) => b.count), 1);
            return data.byStatus.map((b) => {
              const meta = STATUS_CHART[b.status];
              return (
                <div
                  key={b.status}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <span className="font-mono text-[11.5px] font-semibold text-[#475569]">
                    {b.count}
                  </span>
                  <div
                    className="w-full rounded-t-[5px]"
                    style={{
                      height: `${(b.count / max) * 100}%`,
                      background: meta.color,
                    }}
                  />
                  <span className="text-[11.5px] text-muted">
                    {t(`status.${b.status}`)}
                  </span>
                </div>
              );
            });
          })()}
        </div>
      ) : null}
    </Card>
  );
}

export function PriorityDonut() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useDashboardSummary();

  return (
    <Card className="px-5 py-[18px]">
      <div className="mb-4 text-[13.5px] font-semibold text-ink">
        {t("charts.byPriority")}
      </div>

      {isLoading ? <Skeleton className="h-[132px]" /> : null}
      {isError ? (
        <ErrorState message={t("charts.noData")} onRetry={() => refetch()} />
      ) : null}

      {data ? (
        <div className="flex items-center gap-[22px]">
          <div
            className="relative h-[132px] w-[132px] rounded-full"
            style={{
              background: conicGradient(
                data.openByPriority.map((p) => ({
                  value: p.count,
                  color: PRIORITY_CHART[p.priority].color,
                })),
              ),
            }}
          >
            <div className="absolute inset-4 grid place-items-center rounded-full bg-white">
              <div className="text-center">
                <div className="text-[22px] font-bold text-ink">
                  {data.openByPriority.reduce((s, p) => s + p.count, 0)}
                </div>
                <div className="text-[10.5px] text-faint">
                  {t("charts.open")}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 text-[12.5px] text-[#475569]">
            {data.openByPriority.map((p) => (
              <div key={p.priority} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: PRIORITY_CHART[p.priority].color }}
                />
                {t(`priority.${p.priority}`)}
                <span className="ml-auto pl-[18px] font-mono text-[12px] font-semibold text-ink">
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
