import { Suspense } from "react";
import { Topbar } from "@/components/layout/topbar";
import { ReportActions } from "@/features/reports/components/report-actions";
import { ReportDenied } from "@/features/reports/components/report-denied";
import { ReportsBody } from "@/features/reports/components/reports-body";

export default function ReportsPage() {
  return (
    <>
      <Topbar titleKey="nav.reports" showSearch={false} right={<ReportActions />} />
      <main className="flex-1 overflow-y-auto">
        {/* Reads `?denied=1`, so it needs a boundary of its own — without one the
            whole route would opt out of static rendering for a notice that is
            absent on every normal visit. */}
        <Suspense fallback={null}>
          <ReportDenied />
        </Suspense>
        <ReportsBody />
      </main>
    </>
  );
}
