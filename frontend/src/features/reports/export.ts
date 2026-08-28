import type { AgentWorkload, ReportsSummary } from "./schemas";

/**
 * Calendar-day labels for the last `count` days (oldest → today).
 *
 * `locale` is required rather than defaulted: this used to pass `[]`, which
 * means "use the browser's locale" — so the chart axis and the exported CSV
 * were formatted in the machine's language regardless of the one the user had
 * picked in the app. Callers read it from `useI18n()`.
 */
/**
 * Axis labels for the closure trend, read off the buckets themselves.
 *
 * It used to rebuild the window from `new Date()` in the browser, which put the
 * labels on the reader's calendar and the counts on the server's — a closure at
 * 03:00 in Bangkok on a UTC server landed under yesterday's bar with today's date
 * above it. Each `day` arrives as `YYYY-MM-DD`; it is split into parts rather
 * than passed to `new Date(string)`, which would read a bare date as UTC and
 * shift it back by a day for anyone west of Greenwich.
 */
export function trendDayLabels(
  days: readonly { day: string }[],
  locale: string,
): string[] {
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  return days.map(({ day }) => {
    const [y, m, d] = day.split("-").map(Number);
    if (!y || !m || !d) return day;
    return format.format(new Date(y, m - 1, d));
  });
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRows(cells: (string | number)[][]): string {
  return cells.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/**
 * Flatten the reports summary into a single CSV document (KPIs + trend + SLA
 * tables).
 *
 * It used to end with an `Agent, Resolved, Avg resolution (h)` section. That is
 * gone from this document for everyone, rather than trimmed per reader: the
 * function is handed a `ReportsSummary`, and a summary no longer HAS per-agent
 * rows to write. A branch on the reader's role would have been one `if` away
 * from shipping the names in a file that outlives the screen it came from — and
 * a CSV is exactly the artefact that gets mailed on. Per-agent figures have
 * their own export, on the page behind the gate (`workloadToCsv`).
 */
export function reportsToCsv(
  summary: ReportsSummary,
  trendLabels: string[],
): string {
  const { kpis, closureTrend, byPriority, byCategory } = summary;
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
    ...closureTrend.map(({ count }, i) => [trendLabels[i] ?? `Day ${i + 1}`, count]),
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
  ];
  return toRows(sections);
}

/**
 * The per-agent export, kept apart from the one above so that no reader can
 * receive it by accident. Only the workload page offers it, and only a super
 * admin can open that page.
 */
export function workloadToCsv(rows: readonly AgentWorkload[]): string {
  return toRows([
    ["Agent", "Resolved", "Avg resolution (h)"],
    ...rows.map((r) => [r.agent, r.handled, r.avgHandlingHours]),
  ]);
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
