"use client";

import { Card } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_META } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { toneForName } from "@/features/tickets/data";
import { trendDayLabels } from "../export";
import { useReportsSummary } from "../queries";

const ROW = "grid-cols-[130px_1fr_70px_90px]";
const AGENT_ROW = "grid-cols-[1fr_120px_120px]";

// Chart geometry (viewBox units). The series is *scaled* to this box — the old
// code plotted raw counts as y-pixels, so the line was stuck at the top.
const VB = { w: 1080, h: 180, top: 16, bottom: 148, left: 24, right: 1056 };

function buildChart(series: number[]) {
  const n = series.length;
  const max = Math.max(...series, 1);
  const x = (i: number) =>
    VB.left + (i * (VB.right - VB.left)) / Math.max(n - 1, 1);
  const y = (v: number) =>
    VB.top + (1 - v / max) * (VB.bottom - VB.top);
  const points = series.map((v, i) => ({ x: x(i), y: y(v), v }));
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} ${x(n - 1).toFixed(1)},${VB.bottom} ${VB.left},${VB.bottom}`
      : "";
  return { points, line, area, max };
}

export function ReportsBody() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useReportsSummary();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
        <Skeleton className="h-[260px]" />
        <Skeleton className="h-[220px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <Card>
          <ErrorState message="Couldn't load reports" onRetry={() => refetch()} />
        </Card>
      </div>
    );
  }

  const kpis = [
    {
      label: t("report.kpi.avgRes"),
      value: `${data.kpis.avgResolutionHours} h`,
      sub: t("report.kpi.avgRes.sub", { n: data.kpis.resolvedCount }),
    },
    {
      label: t("report.kpi.firstResp"),
      value: `${data.kpis.medianFirstResponseMin} min`,
      sub: t("report.kpi.firstResp.sub"),
    },
    {
      label: t("report.kpi.sla"),
      value: `${data.kpis.slaCompliancePct}%`,
      sub: t("report.kpi.sla.sub", { n: data.kpis.judgedCount }),
    },
  ];

  const labels = trendDayLabels(data.resolutionTrend.length);
  const chart = buildChart(data.resolutionTrend);
  const totalMet = data.byPriority.reduce((a, r) => a + r.met, 0);
  const totalBreached = data.byPriority.reduce((a, r) => a + r.breached, 0);
  const totalJudged = totalMet + totalBreached;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-line bg-panel px-[18px] py-4"
          >
            <div className="text-[12.5px] font-medium text-muted">{k.label}</div>
            <div className="mt-1.5 text-[26px] font-bold leading-none text-ink">
              {k.value}
            </div>
            <div className="mt-2 text-[11.5px] text-faint">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* resolution trend chart */}
      <Card className="px-5 py-[18px]">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[13.5px] font-semibold text-ink">
              {t("report.trend.title")}
            </div>
            <div className="text-[11.5px] text-faint">{t("report.trend.sub")}</div>
          </div>
          <span className="rounded-full bg-[#efe0cd] px-2.5 py-1 font-mono text-[11px] font-semibold text-brand-hover">
            {t("report.trend.peak", { n: chart.max })}
          </span>
        </div>

        {totalJudged === 0 && chart.max <= 1 && data.kpis.resolvedCount === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-faint">
            {t("report.empty")}
          </div>
        ) : (
          <>
            <svg
              className="mt-3.5"
              width="100%"
              height="180"
              viewBox={`0 0 ${VB.w} ${VB.h}`}
              preserveAspectRatio="none"
            >
              {/* horizontal gridlines at 0 / 50 / 100% of the scaled range */}
              {[0, 0.5, 1].map((f) => {
                const gy = VB.top + f * (VB.bottom - VB.top);
                return (
                  <line
                    key={f}
                    x1={VB.left}
                    y1={gy}
                    x2={VB.right}
                    y2={gy}
                    stroke="#eef1f5"
                    strokeWidth="1"
                  />
                );
              })}
              <polygon points={chart.area} fill="rgba(125,83,41,.10)" />
              <polyline
                points={chart.line}
                fill="none"
                stroke="#7d5329"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {chart.points.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="4"
                  fill="#7d5329"
                  stroke="#fff"
                  strokeWidth="2"
                />
              ))}
            </svg>
            <div className="flex justify-between px-1 pt-1 font-mono text-[10.5px] font-medium text-faint">
              {labels.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* SLA by priority */}
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <div className="border-b border-[#eef1f5] px-5 py-3.5">
          <div className="text-[13.5px] font-semibold text-ink">
            {t("report.byPriority.title")}
          </div>
          <div className="text-[11.5px] text-faint">
            {t("report.byPriority.sub")}
          </div>
        </div>
        <div
          className={`grid ${ROW} border-b border-[#eef1f5] bg-[#fafbfc] px-5 py-2.5 text-[11.5px] font-semibold text-faint`}
        >
          <span>{t("report.col.priority")}</span>
          <span>{t("report.col.compliance")}</span>
          <span>{t("report.col.met")}</span>
          <span>{t("report.col.breached")}</span>
        </div>
        {data.byPriority.map((r) => {
          const color = PRIORITY_META[r.priority].dot;
          return (
            <div
              key={r.priority}
              className={`grid ${ROW} items-center border-b border-[#f1f4f8] px-5 py-2.5 text-[12.5px]`}
            >
              <span className="flex items-center gap-1.5 text-[#475569]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                {t(`priority.${r.priority}`)}
              </span>
              <span className="flex items-center gap-2.5">
                <span className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-[#f1f5f9]">
                  <span
                    className="block h-full rounded-[4px]"
                    style={{ width: `${r.compliancePct}%`, background: color }}
                  />
                </span>
                <span className="w-11 font-mono text-[12px] font-semibold text-ink">
                  {r.compliancePct.toFixed(1)}%
                </span>
              </span>
              <span className="font-mono text-[12px] font-medium text-[#475569]">
                {r.met}
              </span>
              <span className="font-mono text-[12px] font-medium text-[#dc2626]">
                {r.breached}
              </span>
            </div>
          );
        })}
        {/* totals */}
        <div
          className={`grid ${ROW} items-center bg-[#fafbfc] px-5 py-2.5 text-[12.5px] font-semibold`}
        >
          <span className="text-ink">{t("report.total")}</span>
          <span className="font-mono text-[12px] text-ink">
            {totalJudged > 0
              ? `${((totalMet / totalJudged) * 100).toFixed(1)}%`
              : "—"}
          </span>
          <span className="font-mono text-[12px] text-[#475569]">{totalMet}</span>
          <span className="font-mono text-[12px] text-[#dc2626]">
            {totalBreached}
          </span>
        </div>
      </div>

      {/* SLA by category */}
      {data.byCategory.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <div className="border-b border-[#eef1f5] px-5 py-3.5">
            <div className="text-[13.5px] font-semibold text-ink">
              {t("report.byCategory.title")}
            </div>
            <div className="text-[11.5px] text-faint">
              {t("report.byCategory.sub")}
            </div>
          </div>
          <div
            className={`grid ${ROW} border-b border-[#eef1f5] bg-[#fafbfc] px-5 py-2.5 text-[11.5px] font-semibold text-faint`}
          >
            <span>{t("report.col.category")}</span>
            <span>{t("report.col.compliance")}</span>
            <span>{t("report.col.judged")}</span>
            <span>{t("report.col.breached")}</span>
          </div>
          {data.byCategory.map((r, i) => (
            <div
              key={r.category}
              className={cn(
                `grid ${ROW} items-center px-5 py-2.5 text-[12.5px]`,
                i < data.byCategory.length - 1 && "border-b border-[#f1f4f8]",
              )}
            >
              <span className="truncate text-[#475569]">{r.category}</span>
              <span className="flex items-center gap-2.5">
                <span className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-[#f1f5f9]">
                  <span
                    className="block h-full rounded-[4px]"
                    style={{ width: `${r.compliancePct}%`, background: "#3f8f5e" }}
                  />
                </span>
                <span className="w-11 font-mono text-[12px] font-semibold text-ink">
                  {r.compliancePct.toFixed(1)}%
                </span>
              </span>
              <span className="font-mono text-[12px] font-medium text-[#475569]">
                {r.judged}
              </span>
              <span className="font-mono text-[12px] font-medium text-[#dc2626]">
                {r.breached}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Throughput by agent */}
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <div className="border-b border-[#eef1f5] px-5 py-3.5">
          <div className="text-[13.5px] font-semibold text-ink">
            {t("report.byAgent.title")}
          </div>
          <div className="text-[11.5px] text-faint">
            {t("report.byAgent.sub")}
          </div>
        </div>
        {data.byAgent.length === 0 ? (
          <div className="px-5 py-6 text-center text-[12.5px] text-faint">
            {t("report.sectionEmpty")}
          </div>
        ) : (
          <>
            <div
              className={`grid ${AGENT_ROW} border-b border-[#eef1f5] bg-[#fafbfc] px-5 py-2.5 text-[11.5px] font-semibold text-faint`}
            >
              <span>{t("report.col.agent")}</span>
              <span>{t("report.col.resolved")}</span>
              <span>{t("report.col.avgRes")}</span>
            </div>
            {data.byAgent.map((r, i) => (
              <div
                key={r.agent}
                className={cn(
                  `grid ${AGENT_ROW} items-center px-5 py-2.5 text-[12.5px]`,
                  i < data.byAgent.length - 1 && "border-b border-[#f1f4f8]",
                )}
              >
                <span className="flex items-center gap-2 truncate text-ink">
                  <Avatar
                    name={r.agent}
                    tone={toneForName(r.agent)}
                    size={22}
                  />
                  {r.agent}
                </span>
                <span className="font-mono text-[12px] font-medium text-[#475569]">
                  {r.resolved}
                </span>
                <span className="font-mono text-[12px] font-medium text-[#475569]">
                  {r.avgResolutionHours} h
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
