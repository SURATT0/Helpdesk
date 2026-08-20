import type { ReportsSummary } from "./schemas";

/**
 * Calendar-day labels for the last `count` days (oldest → today).
 *
 * `locale` is required rather than defaulted: this used to pass `[]`, which
 * means "use the browser's locale" — so the chart axis and the exported CSV
 * were formatted in the machine's language regardless of the one the user had
 * picked in the app. Callers read it from `useI18n()`.
 */
export function trendDayLabels(count: number, locale: string): string[] {
  const out: string[] = [];
  const today = new Date();
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(format.format(d));
  }
  return out;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRows(cells: (string | number)[][]): string {
  return cells.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/** Flatten the reports summary into a single CSV document (KPIs + trend + SLA table). */
export function reportsToCsv(
  summary: ReportsSummary,
  trendLabels: string[],
): string {
  const { kpis, closureTrend, byPriority, byCategory, byAgent } = summary;
  const sections: (string | number)[][] = [
    ["Metric", "Value"],
    // Named for what they measure: the CSV outlives the screen it came from.
    ["Avg handling time, opened to closed (h)", kpis.avgHandlingHours],
    ["First response time, median (min)", kpis.medianFirstResponseMin],
    ["SLA compliance (%)", kpis.slaCompliancePct],
    ["Closed tickets measured", kpis.handledCount],
    ["Tickets judged for SLA", kpis.judgedCount],
    [],
    ["Day", "Tickets closed"],
    ...closureTrend.map((n, i) => [trendLabels[i] ?? `Day ${i + 1}`, n]),
    [],
    ["Priority", "Compliance (%)", "Met", "Breached"],
    ...byPriority.map((r) => [r.priority, r.compliancePct, r.met, r.breached]),
    [],
    ["Category", "Compliance (%)", "Judged", "Breached"],
    ...byCategory.map((r) => [
      r.category,
      r.compliancePct,
      r.judged,
      r.breached,
    ]),
    [],
    ["Agent", "Resolved", "Avg resolution (h)"],
    ...byAgent.map((r) => [r.agent, r.handled, r.avgHandlingHours]),
  ];
  return toRows(sections);
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  // Prepend a BOM so Excel opens UTF-8 (Thai text) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
