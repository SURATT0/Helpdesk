"use client";

import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deskTransitionsFrom,
  requiresResolution,
  type TicketStatus,
} from "@/lib/ticket-status";
import { apiErrorMessage } from "@/lib/api-error";
import { hasPermission } from "@/lib/permissions";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useUpdateTicketStatus } from "../queries";
import { ResolutionDialog } from "./resolution-dialog";
import type { Ticket } from "../schemas";

/**
 * Status control for the properties rail. Whoever cannot work tickets sees a
 * plain badge; whoever can gets a dropdown of the transitions the domain
 * whitelist allows, which drive the live PATCH mutation.
 *
 * Keyed on `ticket:write` — the permission `PATCH /tickets/:id/status` is gated
 * on — rather than on a role list. It used to read
 * `["super_admin", "admin"].includes(user.role)`, which stopped being the same
 * question when the grants became editable: revoking `ticket:write` from admin
 * left this dropdown on screen, and every choice in it 403ing.
 */
export function StatusMenu({ ticket }: { ticket: Ticket }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const canWrite = hasPermission(user, "ticket:write");
  const mutation = useUpdateTicketStatus();
  const [open, setOpen] = React.useState(false);
  // Which status the resolution dialog is collecting text for, or null when it
  // is shut. Holding the target rather than a boolean is what lets the dialog
  // word its submit button for the move actually being made.
  const [resolving, setResolving] = React.useState<TicketStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // `deskTransitionsFrom`, not the raw whitelist: `new → cancelled` is a legal
  // move but not the desk's to make, and the API refuses it on this endpoint.
  const nextStatuses = deskTransitionsFrom(ticket.status);

  if (!canWrite || nextStatuses.length === 0) {
    return <StatusBadge status={ticket.displayStatus} />;
  }

  /**
   * Both moves out of `new` finish the work, so both ask what was done before
   * they patch — see `requiresResolution`. Everything else (reopening, sending
   * a pending ticket back) writes straight through, because nothing was
   * finished and there is nothing to describe.
   */
  function choose(status: TicketStatus) {
    setOpen(false);
    if (requiresResolution(ticket.status, status)) {
      setError(null);
      setResolving(status);
      return;
    }
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

      {resolving ? (
        <ResolutionDialog
          target={resolving}
          busy={mutation.isPending}
          error={error}
          onCancel={() => setResolving(null)}
          onSubmit={(resolution) => {
            setError(null);
            mutation.mutate(
              { id: ticket.id, status: resolving, resolution },
              {
                onSuccess: () => setResolving(null),
                onError: (err) =>
                  setError(apiErrorMessage(err, t, "status.updateError")),
              },
            );
          }}
        />
      ) : null}

      {/* The inline error is for a write that went straight through; one from
          the dialog is shown inside it, beside the text it was rejected for. */}
      {mutation.isError && !resolving ? (
        <span className="text-meta font-medium text-danger">
          {apiErrorMessage(mutation.error, t, "status.updateError")}
        </span>
      ) : null}
    </div>
  );
}
