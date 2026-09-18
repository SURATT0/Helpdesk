"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/features/i18n/context";

/**
 * "You have typed something — throw it away?"
 *
 * Asked when somebody tries to leave the new-ticket form with work in it. The
 * backdrop, Escape and the close button all arrive here, because all three are
 * the same accident: a click landing an inch wide of a form somebody has been
 * filling in for a minute.
 *
 * `z-[60]`, one step above the `z-50` every other Dialog defaults to. This is
 * the one dialog in the app that opens ON TOP of another, and at equal z the
 * later-portalled node wins only by DOM order — true today, and not a thing to
 * leave resting on.
 *
 * Its own `onClose` means "keep writing", not "discard". So the safe answer is
 * the one every dismissal gesture gives: Escape out of this, click its
 * backdrop, press Cancel — all of them put the person back in their form. Only
 * the one button destroys anything, and it is the one wearing the danger
 * colour.
 *
 * A component rather than `window.confirm`: that one cannot be styled, cannot
 * be translated, blocks the whole page thread, and is suppressible by the
 * browser — which would turn "are you sure" into a silent yes.
 */
export function DiscardDraftDialog({
  onKeep,
  onDiscard,
}: {
  /** Back to the form, nothing lost. */
  onKeep: () => void;
  /** Throw the draft away and let the modal close. */
  onDiscard: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open
      onClose={onKeep}
      label={t("create.discardTitle")}
      z="z-[60]"
      panelClassName="max-w-[420px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            size={16}
            className="mt-px flex-none text-warn"
            aria-hidden
          />
          <div>
            <div className="text-dialog font-semibold text-ink">
              {t("create.discardTitle")}
            </div>
            <p className="mt-1 text-body text-subtle">
              {t("create.discardBody")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onKeep}>
            {t("create.discardKeep")}
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            {t("create.discardConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
