"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api-error";
import { TEXT_MAX } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { useEditOwnTicket } from "../queries";
import type { Ticket } from "../schemas";

/**
 * The requester correcting what they wrote.
 *
 * Subject and description only — the two things they are the author of.
 * Priority and category feed the SLA deadline at creation, so changing those is
 * a different decision from fixing a typo and is the desk's.
 *
 * The button that opens this is already hidden once the desk has answered, but
 * the refusal can still arrive: somebody can reply while this dialog is open.
 * That is why the error is rendered here in full rather than assumed away — and
 * why each reason gets its own sentence. "The desk has started, comment
 * instead" and "this is closed" ask for different things next.
 */
export function EditTicketModal({
  ticket,
  open,
  onClose,
}: {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const edit = useEditOwnTicket(ticket.id);
  const [subject, setSubject] = React.useState(ticket.subject);
  const [description, setDescription] = React.useState(ticket.description);

  /*
   * Re-seed from the ticket when the dialog CLOSES, so the next open starts
   * from what is on the server rather than from an abandoned edit — and so a
   * reply that arrived while it was open is reflected.
   *
   * On the way out rather than the way in: an effect runs after paint, so a
   * reset on open would briefly show the fields live and then overwrite
   * anything typed in that frame. Same reason the create dialog resets on
   * close.
   */
  React.useEffect(() => {
    if (open) return;
    setSubject(ticket.subject);
    setDescription(ticket.description);
    edit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticket.subject, ticket.description]);

  const trimmed = subject.trim();
  const changed =
    trimmed !== ticket.subject.trim() ||
    description.trim() !== ticket.description.trim();
  const valid = trimmed.length >= 3 && description.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} labelledBy="edit-ticket-title">
      <div className="flex max-h-[80vh] flex-col">
        <div
          id="edit-ticket-title"
          className="mb-4 text-lead font-semibold text-ink"
        >
          {t("editTicket.title")}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div>
            <Label htmlFor="edit-ticket-subject">{t("editTicket.subject")}</Label>
            <Input
              id="edit-ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={TEXT_MAX.SUBJECT}
            />
          </div>
          <div>
            <Label htmlFor="edit-ticket-description">
              {t("editTicket.description")}
            </Label>
            <Textarea
              id="edit-ticket-description"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={TEXT_MAX.BODY}
            />
          </div>

          {edit.isError ? (
            <div
              role="alert"
              className="rounded-md border border-danger-edge bg-danger-bg px-3 py-2 text-dense font-medium text-danger-ink"
            >
              {apiErrorMessage(edit.error, t, "editTicket.error")}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={edit.isPending}>
            {t("editTicket.cancel")}
          </Button>
          <Button
            onClick={() =>
              edit.mutate(
                { subject: trimmed, description: description.trim() },
                { onSuccess: onClose },
              )
            }
            disabled={!valid || !changed || edit.isPending}
          >
            {edit.isPending ? t("editTicket.saving") : t("editTicket.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
