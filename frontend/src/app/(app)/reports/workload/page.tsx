import { Topbar } from "@/components/layout/topbar";
import { WorkloadView } from "@/features/reports/components/workload-view";

export default function WorkloadPage() {
  return (
    <>
      <Topbar titleKey="nav.workload" showSearch={false} />
      <main className="flex-1 overflow-y-auto">
        <WorkloadView />
      </main>
    </>
  );
}
