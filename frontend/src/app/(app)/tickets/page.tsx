"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { FilterBar } from "@/features/tickets/components/filter-bar";
import { TicketTable } from "@/features/tickets/components/ticket-table";
import { TicketListFooter } from "@/features/tickets/components/ticket-list-footer";
import { TicketBoard } from "@/features/tickets/components/ticket-board";
import { ImportTicketsModal } from "@/features/tickets/components/import-tickets-modal";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

type View = "list" | "board";

// Roles that may bulk-import tickets (mirrors the backend `ticket:import` grant).
const CAN_IMPORT = new Set(["admin", "manager", "agent"]);

export default function TicketsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [view, setView] = React.useState<View>("list");
  const [importOpen, setImportOpen] = React.useState(false);
  const canImport = user ? CAN_IMPORT.has(user.role) : false;

  return (
    <>
      <Topbar
        titleKey="nav.tickets"
        showSearch={false}
        right={
          <div className="flex items-center gap-2.5">
            {canImport ? (
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-[7px] text-[12.5px] font-medium text-[#475569] hover:bg-app"
              >
                <Upload size={14} strokeWidth={2} />
                {t("import.button")}
              </button>
            ) : null}
            <div className="flex overflow-hidden rounded-md border border-line text-[12.5px] font-medium">
              {(["list", "board"] as const).map((v, i) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "px-3 py-[7px]",
                    i > 0 && "border-l border-line",
                    view === v
                      ? "bg-[#f1f5f9] font-semibold text-ink"
                      : "text-muted hover:bg-app",
                  )}
                >
                  {t(`tickets.${v}`)}
                </button>
              ))}
            </div>
          </div>
        }
      />
      {canImport ? (
        <ImportTicketsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      <main className="flex-1 overflow-y-auto">
        {view === "list" ? (
          <>
            <FilterBar />
            <TicketTable />
            <TicketListFooter />
          </>
        ) : (
          <TicketBoard />
        )}
      </main>
    </>
  );
}
