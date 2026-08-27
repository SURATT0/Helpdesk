"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { FIELD_TEXT_13, Input, Label, Textarea } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { uploadAttachment } from "@/features/attachments/api";
import { useKbSuggest } from "@/features/kb/queries";
import { useI18n } from "@/features/i18n/context";
import { useCategories, useCreateTicket } from "../queries";
import { PRIORITIES_ASCENDING, TEXT_MAX, type Priority } from "@/lib/domain";

// Images + common help-desk data files (mirrors the backend allowlist).
const ACCEPT =
  "image/*,.pdf,.csv,.xls,.xlsx,application/pdf,text/csv," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mildest first — a person filling this in is choosing on a scale, not working
// a queue. The one list lives in lib/domain; this names which way up it goes.
const PRIORITIES = PRIORITIES_ASCENDING;

export function CreateTicketModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { data: categories = [] } = useCategories();
  const createTicket = useCreateTicket();

  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<number | null>(null);
  const [priority, setPriority] = React.useState<Priority>("medium");
  const [files, setFiles] = React.useState<File[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [attaching, setAttaching] = React.useState(false);
  const [attachError, setAttachError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /**
   * De-duplication key for the submission being composed.
   *
   * Regenerated whenever the content changes, which is what makes it mean "this
   * exact submission" rather than "this dialog session". The two cases it has
   * to tell apart:
   *
   * - Submit fails, the person presses the button again unchanged. Same key, so
   *   if the first attempt actually reached the server and only the response was
   *   lost, they get that ticket back instead of a second one.
   * - Submit fails, the person edits and sends again. New key, so the edit is a
   *   new ticket rather than being silently answered with the original.
   */
  const [idempotencyKey, setIdempotencyKey] = React.useState("");
  React.useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [subject, description, categoryId, priority]);

  // Live KB deflection: suggest articles from the subject once it's meaningful.
  const suggest = useKbSuggest(subject, subject.trim().length >= 3);
  const suggestions = suggest.data ?? [];

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // Reset the form each time the modal opens.
  React.useEffect(() => {
    if (!open) return;
    setSubject("");
    setDescription("");
    setPriority("medium");
    setCategoryId(categories[0]?.id ?? null);
    setFiles([]);
    setAttaching(false);
    setAttachError(null);
    createTicket.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the category once the list loads.
  React.useEffect(() => {
    if (categoryId == null && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  if (!open) return null;

  const busy = createTicket.isPending || attaching;
  const canSubmit =
    subject.trim().length >= 3 &&
    description.trim().length >= 1 &&
    categoryId != null &&
    !busy;

  /**
   * Refuse to close while the request is in flight — the ticket may already
   * exist, so there is nothing left to cancel, and letting the dialog go would
   * leave `submit` to finish into a closed dialog and navigate to a ticket the
   * person believed they had abandoned. Routed through here rather than only
   * disabling the Cancel button because Escape and the backdrop reach `onClose`
   * on their own.
   */
  function requestClose() {
    if (busy) return;
    onClose();
  }

  async function submit() {
    if (categoryId == null) return;
    setAttachError(null);
    try {
      const ticket = await createTicket.mutateAsync({
        subject: subject.trim(),
        description: description.trim(),
        categoryId,
        priority,
        idempotencyKey,
      });
      // Ticket exists — upload any attachments (best-effort, sequential).
      if (files.length > 0) {
        setAttaching(true);
        const failed: string[] = [];
        for (const file of files) {
          try {
            await uploadAttachment(ticket.id, file);
          } catch {
            failed.push(file.name);
          }
        }
        setAttaching(false);
        if (failed.length > 0) {
          // The ticket was created; just flag which files didn't attach.
          setAttachError(t("create.attachError", { names: failed.join(", ") }));
          return;
        }
      }
      onClose();
      router.push(`/tickets/${ticket.id}`);
    } catch {
      // create failure is surfaced via createTicket.isError below
      setAttaching(false);
    }
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      labelledBy="create-ticket-title"
      align="start"
      backdrop="bg-ink/45"
      padding="sm:p-[44px]"
      panelClassName="max-w-[712px]"
    >
      <div className="overflow-hidden rounded-[14px] bg-white shadow-modal">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-[18px]">
          <div>
            <div id="create-ticket-title" className="text-field font-bold text-ink">
              {t("create.title")}
            </div>
            <div className="mt-0.5 text-dense text-faint">
              {t("create.subtitle")}
            </div>
          </div>
          <button
            onClick={requestClose}
            disabled={busy}
            className={cn(
              "grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-line text-muted hover:bg-app disabled:opacity-40",
              TOUCH_TARGET,
            )}
            aria-label={t("create.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-[22px]">
          <div>
            <Label htmlFor="ticket-subject">
              {t("create.subject")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="ticket-subject"
              autoFocus
              maxLength={TEXT_MAX.SUBJECT}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("create.subjectPlaceholder")}
            />
          </div>

          {/* KB deflection — live suggestions from the subject */}
          {suggestions.length > 0 ? (
            <div className="rounded-[9px] border border-accent-line bg-accent-soft px-3.5 py-3">
              <div className="mb-2 text-meta font-bold tracking-[0.06em] text-brand-hover">
                {t("create.suggested")}
              </div>
              <div className="flex flex-col gap-1.5 text-body">
                {suggestions.map((a) => (
                  <Link
                    key={a.id}
                    href={`/kb/${a.id}`}
                    target="_blank"
                    className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent-edge"
                  >
                    <span className="rounded-[4px] bg-accent-edge px-1.5 py-0.5 font-mono text-counter font-semibold text-brand-hover">
                      {a.id}
                    </span>
                    <span className="font-medium text-[#2f6b46]">{a.title}</span>
                    <span className="ml-auto whitespace-nowrap text-meta text-faint">
                      {t("kb.readMin", { n: a.readMin })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {/* Side by side only once there is room: at 375px two columns
              left each field about 110px, which is not a usable input. */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="ticket-category">
                {t("create.category")} <span className="text-danger">*</span>
              </Label>
              <select
                id="ticket-category"
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className={cn(
                  "w-full rounded-md border border-edge bg-white px-3.5 py-2.5 text-ink",
                  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                  FIELD_TEXT_13,
                )}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label id="ticket-priority-label">{t("create.priority")}</Label>
              <div
                role="group"
                aria-labelledby="ticket-priority-label"
                className="flex overflow-hidden rounded-md border border-edge text-center text-body font-medium"
              >
                {PRIORITIES.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={priority === p}
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 py-2.5",
                      i > 0 && "border-l border-edge",
                      priority === p
                        ? "bg-accent-soft font-semibold text-brand-hover"
                        : "text-muted",
                    )}
                  >
                    {t(`priority.${p}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="ticket-description">
              {t("create.description")} <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="ticket-description"
              rows={3}
              maxLength={TEXT_MAX.BODY}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
            />
          </div>

          <div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                fileInputRef.current?.click()
              }
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={cn(
                "flex cursor-pointer flex-wrap items-center justify-center gap-1.5 rounded-[9px] border-[1.5px] border-dashed px-4 py-[18px] text-body transition-colors",
                dragging
                  ? "border-brand bg-accent-soft text-brand-hover"
                  : "border-dim bg-wash text-muted",
              )}
            >
              <Upload size={16} strokeWidth={2} />
              {t("create.dropText")}{" "}
              <span className="font-semibold text-brand-hover">
                {t("create.browse")}
              </span>
              <span className="text-faint">{t("create.dropHint")}</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {files.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1.5">
                {files.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-dense"
                  >
                    <FileText
                      size={14}
                      strokeWidth={2}
                      className="flex-none text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-strong">
                      {f.name}
                    </span>
                    <span className="flex-none text-meta text-faint">
                      {formatSize(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={t("create.remove", { name: f.name })}
                      className="flex-none text-faint hover:text-danger"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {createTicket.isError ? (
            <div className="rounded-md border border-danger-edge bg-danger-bg px-3 py-2 text-body font-medium text-danger-ink">
              {createTicket.error instanceof ApiError
                ? createTicket.error.message
                : t("create.createError")}
            </div>
          ) : null}

          {attachError ? (
            <div className="rounded-md border border-[#fed7aa] bg-warn-wash px-3 py-2 text-body font-medium text-warn-ink">
              {attachError} — {t("create.attachErrorNote")}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-hairline bg-wash px-6 py-4">
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {createTicket.isPending
              ? t("create.creating")
              : attaching
                ? t("composer.attaching")
                : t("create.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
