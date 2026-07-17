import { Sidebar } from "@/components/layout/sidebar";
import { MobileNavProvider } from "@/components/layout/mobile-nav-context";
import { CreateTicketProvider } from "@/features/tickets/create-ticket-context";
import { SearchProvider } from "@/features/tickets/search-context";
import { RequireAuth } from "@/features/auth/require-auth";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <SearchProvider>
        <CreateTicketProvider>
          <MobileNavProvider>
            {/* On lg+ a fixed two-column grid; below that the sidebar becomes an
                off-canvas drawer and the content spans the full width. */}
            <div className="h-screen overflow-hidden bg-app lg:grid lg:grid-cols-[224px_1fr]">
              <Sidebar />
              <div className="flex h-screen min-w-0 flex-col overflow-hidden lg:h-auto">
                {children}
              </div>
            </div>
          </MobileNavProvider>
        </CreateTicketProvider>
      </SearchProvider>
    </RequireAuth>
  );
}
