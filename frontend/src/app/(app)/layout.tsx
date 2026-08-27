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
                off-canvas drawer and the content spans the full width.

                Height is `dvh`, not `vh`: a mobile browser measures `100vh`
                against the viewport with its URL bar *collapsed*, so a `100vh`
                box with `overflow-hidden` puts its own last ~15% permanently
                out of reach — which on this shell is whatever sits at the
                bottom of the scroll container (the ticket composer, the ticket
                list footer). `dvh` tracks the bar as it shows and hides. The
                two are identical on desktop. */}
            <div className="h-dvh overflow-hidden bg-app lg:grid lg:grid-cols-shell">
              <Sidebar />
              <div className="flex h-dvh min-w-0 flex-col overflow-hidden lg:h-auto">
                {children}
              </div>
            </div>
          </MobileNavProvider>
        </CreateTicketProvider>
      </SearchProvider>
    </RequireAuth>
  );
}
