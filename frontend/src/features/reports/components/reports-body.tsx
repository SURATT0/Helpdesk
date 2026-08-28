"use client";

import { Card } from "@/components/ui/card";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { TableScroll } from "@/components/ui/table-scroll";
import { PRIORITY_META } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { formatDuration } from "@/features/tickets/duration";
import { trendDayLabels } from "../export";
import { useReportsSummary } from "../queries";

const ROW = "grid-cols-[130px_1fr_70px_90px]";

// 290px of fixed columns + 40px of row padding. The `1fr` column holds the
// compliance bar next to a 44px percentage, so it needs real width or the bar
// reads as empty; this floor gives it ~190px, and the columns scroll below that
// rather than compressing into it. (The agent table's own floor moved with the
// table to workload-view.tsx.)
const ROW_MIN_WIDTH = 520;

// Chart geometry (viewBox units). The series is *scaled* to this box — the old
// code plotted raw counts as y-pixels, so the line was stuck at the top.
const VB = { w: 1080, h: 180, top: 16, bottom: 148, left: 24, right: 1056 };

function buildChart(series: number[]) {
  const n = series.length;
  /**
   * The real high-water mark, which is what the badge reports.
   *
   * Kept apart from `scale` below. They used to be one value, so the floor that
   * stops the plot dividing by zero was also printed as "peak 1/day" — a week
   * with nothing closed in it claimed a closure that never happened, on the empty
   * state and on any quiet week alike.
   */
  const peak = series.length ? Math.max(...series) : 0;
  const scale = Math.max(peak, 1);
  const x = (i: number) =>
    VB.left + (i * (VB.right - VB.left)) / Math.max(n - 1, 1);
  const y = (v: number) =>
    VB.top + (1 - v / scale) * (VB.bottom - VB.top);
  const points = series.map((v, i) => ({ x: x(i), y: y(v), v }));
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} ${x(n - 1).toFixed(1)},${VB.bottom} ${VB.left},${VB.bottom}`
      : "";
  return { points, line, area, peak };
}

export function ReportsBody() {
  const { t, locale } = useI18n();
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
          <ErrorState message={t("report.loadError")} onRetry={() => refetch()} />
        </Card>
      </div>
    );
  }

  // Hours and minutes, not a raw count in one unit: "184 min" and "15.7 h" are
  // both numbers the reader has to convert before they mean anything. Shared by
  // both time KPIs and the agent table so no two durations on the page are
  // written differently.
  const units = {
    d: t("closedLog.unit.d"),
    h: t("closedLog.unit.h"),
    m: t("closedLog.unit.m"),
  };
  const hours = (n: number) => formatDuration(n * 3_600_000, units);
  /**
   * Nothing measured reads as a dash, never as a figure.
   *
   * `formatDuration(0)` is "<1m" and 0% is 0%, so an account with no finished
   * tickets announced sub-minute handling and total SLA failure — the two most
   * alarming numbers on the page, from an absence of data. The counts below each
   * tile said "across 0 tickets", but the figure is what gets read.
   */
  const noneYet = t("sla.none");

  const kpis = [
    {
      label: t("report.kpi.avgRes"),
      value: data.kpis.handledCount
        ? hours(data.kpis.avgHandlingHours)
        : noneYet,
      sub: t("report.kpi.avgRes.sub", { n: data.kpis.handledCount }),
    },
    {
      label: t("report.kpi.firstResp"),
      value: data.kpis.medianFirstResponseMin
        ? formatDuration(data.kpis.medianFirstResponseMin * 60_000, units)
        : noneYet,
      sub: t("report.kpi.firstResp.sub"),
    },
    {
      label: t("report.kpi.sla"),
      value: data.kpis.judgedCount
        ? `${data.kpis.slaCompliancePct}%`
        : noneYet,
      sub: t("report.kpi.sla.sub", { n: data.kpis.judgedCount }),
    },
  ];

  const labels = trendDayLabels(data.closureTrend, locale);
  const chart = buildChart(data.closureTrend.map((d) => d.count));
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
            <div className="text-body font-medium text-muted">{k.label}</div>
            <div className="mt-1.5 text-figure font-bold leading-none text-ink">
              {k.value}
            </div>
            <div className="mt-2 text-caption text-faint">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* resolution trend chart */}
      <Card className="px-5 py-[18px]">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-lead font-semibold text-ink">
              {t("report.trend.title")}
            </div>
            <div className="text-caption text-faint">{t("report.trend.sub")}</div>
          </div>
          <span className="rounded-full bg-[#efe0cd] px-2.5 py-1 font-mono text-meta font-semibold text-brand-hover">
            {t("report.trend.peak", { n: chart.peak })}
          </span>
        </div>

        {/* Nothing judged, nothing closed and no bar to draw — say so rather than
            plot a flat line along the floor. `peak` is the real high-water mark
            now, so this reads as "no closures" instead of leaning on the old
            scale floor of 1. */}
        {totalJudged === 0 && chart.peak === 0 && data.kpis.handledCount === 0 ? (
          <div className="py-10 text-center text-body text-faint">
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
            <div className="flex justify-between px-1 pt-1 font-mono text-eyebrow font-medium text-faint">
              {labels.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* SLA by priority */}
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {/* Outside the scroller: the section's own title should not slide away
            when the columns are scrolled. */}
        <div className="border-b border-hairline px-5 py-3.5">
          <div className="text-lead font-semibold text-ink">
            {t("report.byPriority.title")}
          </div>
          <div className="text-caption text-faint">
            {t("report.byPriority.sub")}
          </div>
        </div>
        <TableScroll minWidth={ROW_MIN_WIDTH}>
        <div
          className={`grid ${ROW} border-b border-hairline bg-wash px-5 py-2.5 text-caption font-semibold text-faint`}
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
              className={`grid ${ROW} items-center border-b border-rule px-5 py-2.5 text-body`}
            >
              <span className="flex items-center gap-1.5 text-subtle">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                {t(`priority.${r.priority}`)}
              </span>
              <span className="flex items-center gap-2.5">
                <span className="h-[7px] flex-1 overflow-hidden rounded bg-fill">
                  <span
                    className="block h-full rounded"
                    style={{ width: `${r.compliancePct}%`, background: color }}
                  />
                </span>
                <span className="w-11 font-mono text-dense font-semibold text-ink">
                  {r.compliancePct.toFixed(1)}%
                </span>
              </span>
              <span className="font-mono text-dense font-medium text-subtle">
                {r.met}
              </span>
              <span className="font-mono text-dense font-medium text-danger">
                {r.breached}
              </span>
            </div>
          );
        })}
        {/* totals */}
        <div
          className={`grid ${ROW} items-center bg-wash px-5 py-2.5 text-body font-semibold`}
        >
          <span className="text-ink">{t("report.total")}</span>
          <span className="font-mono text-dense text-ink">
            {totalJudged > 0
              ? `${((totalMet / totalJudged) * 100).toFixed(1)}%`
              : "—"}
          </span>
          <span className="font-mono text-dense text-subtle">{totalMet}</span>
          <span className="font-mono text-dense text-danger">
            {totalBreached}
          </span>
        </div>
        </TableScroll>
      </div>

      {/* SLA by category. The heading stays even with nothing to show — an empty
          list used to remove the whole block, so a reader with no judged tickets
          never learned the section existed. (The agent table this used to be
          compared with has moved to /reports/workload.) */}
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-hairline px-5 py-3.5">
          <div className="text-lead font-semibold text-ink">
            {t("report.byCategory.title")}
          </div>
          <div className="text-caption text-faint">
            {t("report.byCategory.sub")}
          </div>
        </div>
        {data.byCategory.length === 0 ? (
          // No columns to hold apart, so no scroller — same reasoning as the
          // agent table's empty state.
          <div className="px-5 py-6 text-center text-body text-faint">
            {t("report.sectionEmpty")}
          </div>
        ) : (
          <>
          <TableScroll minWidth={ROW_MIN_WIDTH}>
          <div
            className={`grid ${ROW} border-b border-hairline bg-wash px-5 py-2.5 text-caption font-semibold text-faint`}
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
                `grid ${ROW} items-center px-5 py-2.5 text-body`,
                i < data.byCategory.length - 1 && "border-b border-rule",
              )}
            >
              <span className="truncate text-subtle">{r.category}</span>
              <span className="flex items-center gap-2.5">
                <span className="h-[7px] flex-1 overflow-hidden rounded bg-fill">
                  <span
                    className="block h-full rounded"
                    style={{ width: `${r.compliancePct}%`, background: "#3f8f5e" }}
                  />
                </span>
                <span className="w-11 font-mono text-dense font-semibold text-ink">
                  {r.compliancePct.toFixed(1)}%
                </span>
              </span>
              <span className="font-mono text-dense font-medium text-subtle">
                {r.judged}
              </span>
              <span className="font-mono text-dense font-medium text-danger">
                {r.breached}
              </span>
            </div>
          ))}
          </TableScroll>
          </>
        )}
      </div>

      {/*
        The "Throughput by agent" table used to close this page. It is not
        hidden here — it is not part of this page any more, for anyone. It lives
        on /reports/workload behind the super-admin gate, and this component no
        longer receives the data to draw it, so there is no DOM node, no
        placeholder and no "you don't have access" box telling a reader that a
        table they cannot see exists. The link to it is offered in the topbar
        (ReportActions), to the readers who can follow it.

        The container is `flex flex-col gap-4`, so dropping the last child leaves
        no trailing gap — nothing below needed rebalancing.
      */}
    </div>
  );
}
