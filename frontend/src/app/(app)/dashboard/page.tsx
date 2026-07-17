import { Topbar } from "@/components/layout/topbar";
import { DashboardGreeting } from "@/features/dashboard/components/greeting";
import { StatCards } from "@/features/dashboard/components/stat-cards";
import {
  StatusBarChart,
  PriorityDonut,
} from "@/features/dashboard/components/charts";
import { MyTickets } from "@/features/dashboard/components/my-tickets";

export default function DashboardPage() {
  return (
    <>
      <Topbar />
      <main className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-6">
          <DashboardGreeting />

          <StatCards />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.5fr_1fr]">
            <StatusBarChart />
            <PriorityDonut />
          </div>

          <MyTickets />
        </div>
      </main>
    </>
  );
}
