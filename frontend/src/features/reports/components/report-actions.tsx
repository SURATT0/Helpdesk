"use client";

import { Download } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { useReportsSummary } from "../queries";
import { downloadCsv, reportsToCsv, trendDayLabels } from "../export";

export function ReportActions() {
  const { t } = useI18n();
  const { data } = useReportsSummary();

  function exportCsv() {
    if (!data) return;
    const labels = trendDayLabels(data.resolutionTrend.length);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`deskly-report-${stamp}.csv`, reportsToCsv(data, labels));
  }

  return (
    <>
      <span className="inline-flex items-center rounded-md border border-line bg-white px-3 py-[7px] text-[12.5px] text-[#475569]">
        {t("report.range")}
      </span>
      <button
        type="button"
        onClick={exportCsv}
        disabled={!data}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#475569] hover:bg-app disabled:opacity-50"
      >
        <Download size={13} strokeWidth={2} />
        {t("report.export")}
      </button>
    </>
  );
}
