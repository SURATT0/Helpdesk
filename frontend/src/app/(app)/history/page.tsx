"use client";

import { Topbar } from "@/components/layout/topbar";
import { TicketHistoryView } from "@/features/tickets/components/ticket-history-view";

export default function TicketHistoryPage() {
  return (
    <>
      <Topbar titleKey="nav.history" showSearch={false} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <TicketHistoryView />
      </main>
    </>
  );
}
