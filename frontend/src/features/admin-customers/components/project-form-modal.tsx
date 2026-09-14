"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_HEIGHT } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { TEXT_MAX } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useCreateProject, useUpdateProject } from "@/features/projects/queries";
import type { Project } from "@/features/projects/schemas";

/**
 * Add a project to a customer, or edit one.
 *
 * **The customer is not a field.** It comes from the screen the button was
 * pressed on and is passed in — the old form asked a platform admin to pick one
 * again, having just been looking at that customer's page, and a picker whose
 * answer is already known is a place to get it wrong. It is not merely hidden
 * either: the server files the project under the id sent here, so what the
 * person was looking at is what they get.
 *
 * Two fields, because a project is a name and what it is for. The description is
 * markdown and rendered as such on the project's page; offered here rather than
 * only there because the moment somebody creates a project is the moment they
 * know what it is for, and making them navigate somewhere else to say so is how
 * projects end up with no description at all.
 */
export function ProjectFormModal({
  open,
  customerId,
  customerName,
  /** The project being edited, or null when adding one. */
  project,
  onClose,
}: {
  open: boolean;
  customerId: number;
  customerName: string;
  project: Project | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const create = useCreateProject();
  const update = useUpdateProject();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const titleId = "project-form-title";

  const editing = project != null;
  const busy = create.isPending || update.isPending;

  React.useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setDescription(project?.description ?? "");
      setError(null);
    }
  }, [open, project]);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2 && !busy;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    const onError = (err: unknown) =>
      // The server's sentence, because it names the project that already has
      // this name — and the name is per CUSTOMER, so "taken" without saying
      // whose would be the wrong fact entirely.
      setError(
        err instanceof ApiError ? err.message : t("adminCustomers.projectSaveError"),
      );
    // Empty stays empty rather than becoming an empty string: "nobody has
    // written one" and "somebody wrote nothing" are the same fact, and the
    // server normalises it to null either way.
    const body = { name: trimmed, description: description.trim() || undefined };

    if (editing) {
      update.mutate(
        { id: project.id, input: body },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate({ ...body, customerId }, { onSuccess: onClose, onError });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      labelledBy={titleId}
      panelClassName="max-h-[80vh] max-w-[560px] overflow-hidden rounded-panel border border-line bg-panel shadow-modal"
    >
      {/* Fixed head and foot with a scrolling middle, so the description can be
          as long as it needs to be without pushing the save button off a phone. */}
      <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
        <div className="flex-none border-b border-hairline px-4 py-3 sm:px-5 sm:py-4">
          <h2 id={titleId} className="text-section font-semibold text-ink">
            {editing
              ? t("adminCustomers.editProjectTitle")
              : t("adminCustomers.newProjectTitle")}
          </h2>
          {/* Says which customer this lands under. The field is gone; the fact
              it replaces must not be. */}
          <p className="mt-1 text-body leading-relaxed text-muted">
            {t("adminCustomers.projectForCustomer", { customer: customerName })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <label
            htmlFor="project-name"
            className="mb-1.5 block text-dense font-medium text-subtle"
          >
            {t("adminCustomers.projectName")}
          </label>
          <input
            id="project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={80}
            className={cn(
              "w-full rounded-md border border-edge bg-white px-3 py-2.5 text-ink",
              FIELD_TEXT_13,
              "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
            )}
          />

          <label
            htmlFor="project-description"
            className="mb-1.5 mt-4 block text-dense font-medium text-subtle"
          >
            {t("adminCustomers.projectDescription")}
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={5}
            maxLength={TEXT_MAX.BODY}
            placeholder={t("adminCustomers.projectDescriptionPlaceholder")}
            aria-describedby="project-description-hint"
            className={cn(
              // `w-full` with the reset's `box-border`, so padding cannot push it
              // past the panel at 375px; `resize-y` only, because a horizontally
              // resizable textarea inside a modal is a way to break the layout by
              // dragging.
              "w-full resize-y rounded-md border border-edge bg-white px-3 py-2.5 text-ink",
              FIELD_TEXT_13,
              "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
            )}
          />
          <p
            id="project-description-hint"
            className="mt-1.5 text-caption leading-relaxed text-faint"
          >
            {t("adminCustomers.projectDescriptionHint")}
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-danger-edge bg-danger-bg px-3 py-2.5 text-body font-medium text-danger-ink"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-none flex-col-reverse gap-2 border-t border-hairline px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            className={TOUCH_HEIGHT}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!ready} className={cn("gap-1.5", TOUCH_HEIGHT)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {editing
              ? t("adminCustomers.saveProject")
              : t("adminCustomers.createProject")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
