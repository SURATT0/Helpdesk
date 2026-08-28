"use client";

import Link from "next/link";
import { Download, Users } from "lucide-react";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { maySeeTeamWorkload } from "@/lib/permissions";
import { useReportsSummary } from "../queries";
import { downloadCsv, reportsToCsv, trendDayLabels } from "../export";

export function ReportActions() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { data } = useReportsSummary();

  function exportCsv() {
    if (!data) return;
    const labels = trendDayLabels(data.closureTrend, locale);
    const stamp = new Date().toISOString().slice(0, 10);
    // The summary carries no per-agent rows any more, so this file cannot
    // contain them whoever downloads it — see reportsToCsv.
    downloadCsv(`deskly-report-${stamp}.csv`, reportsToCsv(data, labels));
  }

  return (
    <>
      {/*
        The only entrance to the per-agent table, and it is not rendered at all
        for a reader who may not follow it — no disabled button, no tooltip
        explaining a restriction. The page itself redirects, and the API refuses;
        this is just the door for the people who have the key.
      */}
      {maySeeTeamWorkload(user?.role) ? (
        <Link
          href="/reports/workload"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-[7px] text-body font-semibold text-subtle hover:bg-app"
        >
          <Users size={13} strokeWidth={2} />
          {t("report.byAgent.link")}
        </Link>
      ) : null}
      <span className="inline-flex items-center rounded-md border border-line bg-white px-3 py-[7px] text-body text-subtle">
        {t("report.range")}
      </span>
      <button
        type="button"
        onClick={exportCsv}
        disabled={!data}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-[7px] text-body font-semibold text-subtle hover:bg-app disabled:opacity-50"
      >
        <Download size={13} strokeWidth={2} />
        {t("report.export")}
      </button>
    </>
  );
}
