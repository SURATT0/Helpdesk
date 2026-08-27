"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { useI18n } from "@/features/i18n/context";
import { useDeleteArticle } from "../queries";

/**
 * Confirm retiring an article.
 *
 * Deleting is the one KB action that cannot be walked back — an edit can be
 * re-edited and a publish can be reverted, but the text is gone — so it asks
 * first, and says out loud what happens to the problems that cite it.
 */
export function KbDeleteDialog({
  id,
  title,
  onClose,
  onDeleted,
}: {
  id: string;
  title: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteArticle();
  const [error, setError] = React.useState<string | null>(null);

  function confirm() {
    setError(null);
    remove.mutate(id, {
      onSuccess: () => onDeleted(),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : t("kb.deleteError")),
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      label={t("kb.deleteTitle")}
      panelClassName="max-w-[440px]"
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
              {t("kb.deleteTitle")}
            </div>
            <p className="mt-1 text-body text-subtle">
              {t("kb.deleteBody", { id, title })}
            </p>
            <p className="mt-2 text-body text-faint">
              {t("kb.deleteLinks")}
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-3 text-body font-medium text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("kb.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            disabled={remove.isPending}
          >
            {remove.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("kb.deleting")}
              </>
            ) : (
              t("kb.deleteConfirm")
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
