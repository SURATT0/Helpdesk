"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api-error";
import { TEXT_MAX } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { useCancelTicket } from "../queries";

/**
 * "I do not need this any more" — the requester withdrawing a ticket the desk
 * has not moved yet.
 *
 * A confirm step rather than a bare button, because this ends the ticket and the
 * only way back is to ask the desk to reopen it. The reason is optional for the
 * same reason the rejection's is: "I sorted it myself" is a complete answer, and
 * a required box teaches people to type "-" to get past it. What is typed goes
 * into the thread as a public comment, so whoever had the ticket can see why it
 * went away — the dialog says so, so nobody writes it expecting a private note.
 */
export function CancelTicketDialog({
  ticketId,
  onClose,
  onCancelled,
}: {
  ticketId: number;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { t } = useI18n();
  const cancel = useCancelTicket();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    const trimmed = reason.trim();
    cancel.mutate(
      { id: ticketId, reason: trimmed ? trimmed : undefined },
      {
        onSuccess: () => onCancelled(),
        onError: (err) =>
          setError(apiErrorMessage(err, t, "cancelTicket.error")),
      },
    );
  }

  return (
    <Dialog
      open
      onClose={cancel.isPending ? () => {} : onClose}
      label={t("cancelTicket.title")}
      panelClassName="max-w-[460px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="text-dialog font-semibold text-ink">
          {t("cancelTicket.title")}
        </div>
        <p className="mt-1 text-body text-subtle">{t("cancelTicket.body")}</p>

        <label
          htmlFor="cancel-reason"
          className="mt-3 block text-dense font-semibold text-muted"
        >
          {t("cancelTicket.reason")}
        </label>
        <textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={TEXT_MAX.BODY}
          rows={3}
          placeholder={t("cancelTicket.placeholder")}
          className={`${FIELD_TEXT} mt-1 w-full resize-none`}
        />

        {error ? (
          <div className="mt-3 text-body font-medium text-danger">{error}</div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          {/* "Keep it" rather than "Cancel": in a dialog about cancelling a
              ticket, a button marked Cancel is genuinely ambiguous about which
              of the two things it does. */}
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            {t("cancelTicket.keep")}
          </Button>
          <Button onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("detail.saving")}
              </>
            ) : (
              t("cancelTicket.confirm")
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
