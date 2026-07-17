import { Topbar } from "@/components/layout/topbar";
import { ReportActions } from "@/features/reports/components/report-actions";
import { ReportsBody } from "@/features/reports/components/reports-body";

export default function ReportsPage() {
  return (
    <>
      <Topbar titleKey="nav.reports" showSearch={false} right={<ReportActions />} />
      <main className="flex-1 overflow-y-auto">
        <ReportsBody />
      </main>
    </>
  );
}
