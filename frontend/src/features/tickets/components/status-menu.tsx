"use client";

import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_TRANSITIONS, type TicketStatus } from "@/lib/ticket-status";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUpdateTicketStatus } from "../queries";
import type { Ticket } from "../schemas";

const WRITE_ROLES = ["super_admin", "admin"];

/**
 * Status control for the properties rail. Requesters (no write permission) see
 * a plain badge; write-capable roles get a dropdown of the transitions the
 * domain whitelist allows, which drive the live PATCH mutation.
 */
export function StatusMenu({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const canWrite = user ? WRITE_ROLES.includes(user.role) : false;
  const mutation = useUpdateTicketStatus();
  const [open, setOpen] = React.useState(false);

  const nextStatuses = STATUS_TRANSITIONS[ticket.status] ?? [];

  if (!canWrite || nextStatuses.length === 0) {
    return <StatusBadge status={ticket.displayStatus} />;
  }

  function choose(status: TicketStatus) {
    setOpen(false);
    mutation.mutate({ id: ticket.id, status });
  }

  return (
    <div className="relative flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={mutation.isPending}
        className="disabled:opacity-60"
      >
        <StatusBadge status={ticket.displayStatus} caret />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[150px] rounded-md border border-line bg-white py-1 shadow-modal">
            <div className="px-3 py-1 text-eyebrow font-semibold uppercase tracking-eyebrow text-faint">
              {t("status.moveTo")}
            </div>
            {nextStatuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => choose(s)}
                className="flex w-full items-center px-3 py-1.5 text-left hover:bg-app"
              >
                <StatusBadge status={s} />
              </button>
            ))}
          </div>
        </>
      ) : null}

      {mutation.isError ? (
        <span className="text-meta font-medium text-danger">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : t("status.updateError")}
        </span>
      ) : null}
    </div>
  );
}
