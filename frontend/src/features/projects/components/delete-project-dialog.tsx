"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useDeleteProject, useDeletionImpact } from "../queries";
import type { Project } from "../schemas";

/**
 * Confirming a project deletion.
 *
 * Two brakes, and they do different jobs. The typed name stops the wrong row
 * being deleted by a mis-aimed click; the member guard stops a right-looking
 * deletion that would strand people's routing. Only the first is dismissible by
 * being careful — the second is the server's, and this dialog reports it rather
 * than deciding it.
 *
 * The impact figure is re-read from the API when the dialog opens rather than
 * taken from the row on screen: the list's count can be minutes old, and this
 * number is what the confirm button is enabled on. If the two ever disagree, the
 * server's is the one that decides, and it is the one shown.
 *
 * Deliberately NOT a ticket count. A ticket carries no project — routing reads
 * the requester's project once, when the ticket is created, and keeps only the
 * assignee it picked — so there is no such number to show. What a deletion
 * actually disturbs is routing, and membership is what routing reads.
 */
export function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const impact = useDeletionImpact(project.id);
  const remove = useDeleteProject();

  const members = impact.data?.members;
  const blocked = members != null && members > 0;
  // Exact match, trimmed only at the ends — a name is being copied, not guessed,
  // and trailing whitespace from a paste should not be the thing that stops it.
  const nameMatches = typed.trim() === project.name;
  const canConfirm =
    impact.isSuccess && !blocked && nameMatches && !remove.isPending;

  function submit() {
    if (!canConfirm) return;
    setError(null);
    remove.mutate(project.id, {
      onSuccess: onClose,
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : t("project.delete.error")),
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      label={t("project.delete.title")}
      panelClassName="max-w-[460px]"
    >
      <div className="rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-dialog font-semibold text-ink">
              {t("project.delete.title")}
            </div>
            <div className="mt-0.5 text-body text-subtle">
              {t("project.delete.irreversible")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("project.delete.close")}
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-subtle hover:bg-app",
              TOUCH_TARGET,
            )}
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-line bg-wash p-3">
          <div className="truncate text-control font-semibold text-ink">
            {project.name}
          </div>
          <div className="mt-1 text-caption text-faint" data-impact>
            {impact.isLoading
              ? t("project.delete.counting")
              : impact.isError
                ? t("project.delete.countError")
                : t("project.delete.members", { n: members ?? 0 })}
          </div>
        </div>

        {blocked ? (
          // The server refuses this, so the dialog states it rather than warning
          // about it: there is no "delete anyway" here, and offering one would be
          // offering something the API would reject.
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-warn-edge bg-warn-tint p-3"
          >
            <AlertTriangle size={14} className="mt-px flex-none text-warn" />
            <div className="flex-1 text-body text-warn-ink">
              {t("project.delete.blocked", { n: members ?? 0 })}{" "}
              <Link
                href="/users"
                className="font-semibold underline underline-offset-2"
              >
                {t("project.delete.viewMembers")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <label
              htmlFor="confirm-project-name"
              className="block text-body font-medium text-subtle"
            >
              {t("project.delete.typeName")}
            </label>
            <input
              id="confirm-project-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={project.name}
              className={cn(
                "mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-ink placeholder:text-faint focus:border-brand focus:outline-none",
                FIELD_TEXT_13,
              )}
            />
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-body text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("project.delete.cancel")}
          </Button>
          {/* `danger` is the shared token variant, reserved for exactly this:
              a step that cannot be walked back. No colour is chosen here. */}
          <Button variant="danger" disabled={!canConfirm} onClick={submit}>
            {remove.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : null}
            {t("project.delete.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
