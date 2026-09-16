"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT } from "@/components/ui/input";
import { TEXT_MAX } from "@/lib/domain";
import type { TicketStatus } from "@/lib/ticket-status";
import { useI18n } from "@/features/i18n/context";

/**
 * "What did you do?" — asked once, on the move that finishes the work.
 *
 * The mirror image of `RejectClosureDialog`: that one asks for a reason and
 * accepts none, because refusing is a complete answer. This one REQUIRES text,
 * because finishing a ticket without saying how leaves the next person reading
 * a closed row with the problem and no answer. The submit button stays disabled
 * rather than erroring after the fact, so the requirement is visible before the
 * click and the server's 400 is a backstop nobody should ever see.
 *
 * Shared by all three screens that can finish a ticket — the detail header, the
 * status dropdown and the bulk bar — so the question is worded the same
 * wherever it is asked. `count` is what the bulk bar varies: one resolution is
 * written to every selected ticket, which is right for the case that produces a
 * bulk close (one incident, many tickets) and is stated in the dialog so nobody
 * expects it to be per-ticket.
 */
export function ResolutionDialog({
  target,
  count = 1,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  target: TicketStatus;
  count?: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (resolution: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const trimmed = text.trim();

  const body =
    count > 1
      ? t("resolution.bodyBulk", { n: String(count) })
      : target === "pending"
        ? t("resolution.bodyPending")
        : t("resolution.bodyClosed");

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onCancel}
      label={t("resolution.title")}
      panelClassName="max-w-[460px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="text-dialog font-semibold text-ink">
          {t("resolution.title")}
        </div>
        <p className="mt-1 text-body text-subtle">{body}</p>

        <label
          htmlFor="ticket-resolution"
          className="mt-3 block text-dense font-semibold text-muted"
        >
          {t("resolution.label")}
        </label>
        <textarea
          id="ticket-resolution"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={TEXT_MAX.BODY}
          rows={4}
          autoFocus
          placeholder={t("resolution.placeholder")}
          className={`${FIELD_TEXT} mt-1 w-full resize-none`}
        />

        {error ? (
          <div className="mt-3 text-body font-medium text-danger">{error}</div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("closure.cancel")}
          </Button>
          <Button onClick={() => onSubmit(trimmed)} disabled={busy || !trimmed}>
            {busy ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("detail.saving")}
              </>
            ) : target === "pending" ? (
              t("resolution.submitPending")
            ) : (
              t("resolution.submitClosed")
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
