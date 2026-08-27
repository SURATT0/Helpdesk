"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { TEXT_MAX } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { useRejectClosure } from "../queries";

/**
 * "It is not fixed" — the requester sending a ticket back to the desk.
 *
 * Asks for a reason but does not require one: refusing is a complete answer, and
 * a required box would push people into typing "no" to get past it. What is
 * typed goes into the thread as a public comment, because it is a message to the
 * person who did the work — the dialog says so, so nobody writes it expecting a
 * private note.
 */
export function RejectClosureDialog({
  ticketId,
  onClose,
  onRejected,
}: {
  ticketId: number;
  onClose: () => void;
  onRejected: () => void;
}) {
  const { t } = useI18n();
  const reject = useRejectClosure();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    const trimmed = reason.trim();
    reject.mutate(
      { id: ticketId, reason: trimmed ? trimmed : undefined },
      {
        onSuccess: () => onRejected(),
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : t("closure.rejectError"),
          ),
      },
    );
  }

  return (
    <Dialog
      open
      onClose={reject.isPending ? () => {} : onClose}
      label={t("closure.rejectTitle")}
      panelClassName="max-w-[460px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="text-[14.5px] font-semibold text-ink">
          {t("closure.rejectTitle")}
        </div>
        <p className="mt-1 text-[12.5px] text-[#475569]">
          {t("closure.rejectBody")}
        </p>

        <label
          htmlFor="reject-reason"
          className="mt-3 block text-[12px] font-semibold text-muted"
        >
          {t("closure.rejectReason")}
        </label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={TEXT_MAX.BODY}
          rows={3}
          placeholder={t("closure.rejectPlaceholder")}
          className={`${FIELD_TEXT} mt-1 w-full resize-none`}
        />

        {error ? (
          <div className="mt-3 text-[12.5px] font-medium text-[#dc2626]">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={reject.isPending}>
            {t("closure.cancel")}
          </Button>
          <Button onClick={submit} disabled={reject.isPending}>
            {reject.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("detail.saving")}
              </>
            ) : (
              t("closure.rejectConfirm")
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
