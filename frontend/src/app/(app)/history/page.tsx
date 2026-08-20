"use client";

import { Suspense } from "react";
import { Topbar } from "@/components/layout/topbar";
import { TicketHistoryView } from "@/features/tickets/components/ticket-history-view";

export default function TicketHistoryPage() {
  return (
    <>
      <Topbar titleKey="nav.history" showSearch={false} />
      {/* No top padding, deliberately: the log's search bar is sticky at the top
          of this scroll container, and `top-0` pins to the padding box — any
          padding here would leave a strip above the bar for rows to scroll
          through. The bar supplies that spacing itself instead. */}
      <main className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
        {/* The log reads its opening filters from the query string, and
            `useSearchParams` needs a boundary to suspend at while this route is
            prerendered — without one the build fails rather than the page. */}
        <Suspense>
          <TicketHistoryView />
        </Suspense>
      </main>
    </>
  );
}
