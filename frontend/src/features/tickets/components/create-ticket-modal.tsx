"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { FIELD_TEXT_13, Input, Label, Textarea } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { randomId } from "@/lib/random-id";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ATTACHMENT_ACCEPT } from "@/features/attachments/accept";
import { uploadAttachment } from "@/features/attachments/api";
import { useKbSuggest } from "@/features/kb/queries";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { useCustomers } from "@/features/customers/queries";
import { useProjects } from "@/features/projects/queries";
import { useCategories, useCreateTicket } from "../queries";
import { PRIORITIES_ASCENDING, TEXT_MAX, type Priority } from "@/lib/domain";

// Images + common help-desk data files (mirrors the backend allowlist).

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
  const { user } = useAuth();
  const { data: allCategories = [] } = useCategories();
  const { data: customers = [] } = useCustomers();
  // Projects need `project:read`, which a requester does not hold — asking for
  // them would be a guaranteed 403. Their ticket still routes through their own
  // project automatically, exactly as it did before this field existed.
  const canPickProject = user != null && user.role !== "user";
  const { data: projectData } = useProjects({ enabled: canPickProject });
  const createTicket = useCreateTicket();

  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<number | null>(null);
  /**
   * The tenant the rest of the form is filtered by.
   *
   * NOT where the ticket is filed — the server always files it under the
   * REQUESTER's customer, which for a self-service create is the signed-in
   * person's own. What this governs is which projects and categories are on
   * offer, and it only becomes a question for someone who reaches more than one
   * tenant. With a single customer it is preselected and fixed, because a picker
   * with one option is not a choice.
   */
  const [customerId, setCustomerId] = React.useState<number | null>(null);
  const [projectId, setProjectId] = React.useState<number | null>(null);
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
    // Not `crypto.randomUUID()` directly: it is secure-context only, so it is
    // missing when the app is opened by IP over plain HTTP — and this effect
    // runs with the shell, so the throw took the whole page down. See randomId.
    setIdempotencyKey(randomId());
  }, [subject, description, categoryId, priority]);

  const projects = projectData?.projects ?? [];

  /**
   * The cascade. Each list is what the level above allows, so a choice can never
   * be left pointing at something the current customer does not own.
   *
   * Categories include the SHARED ones (`customerId: null`) alongside that
   * customer's own — the server scopes the same way, and a tenant with no
   * categories of its own must still have the standard list to file under.
   */
  const projectsForCustomer = React.useMemo(
    () => (customerId == null ? [] : projects.filter((p) => p.customerId === customerId)),
    [projects, customerId],
  );
  const categories = React.useMemo(
    () =>
      customerId == null
        ? allCategories.filter((c) => c.customerId == null)
        : allCategories.filter(
            (c) => c.customerId == null || c.customerId === customerId,
          ),
    [allCategories, customerId],
  );

  // One customer means there is nothing to choose: preselect it and leave the
  // control fixed, rather than making someone confirm the only answer.
  const customerFixed = customers.length <= 1;
  React.useEffect(() => {
    if (customerId == null && customers.length === 1) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  /**
   * Changing the customer clears what it invalidated.
   *
   * Both, not just the project: categories are scoped too, so a category picked
   * under the previous customer can be one this one cannot use. Clearing rather
   * than remapping is deliberate — silently moving a choice to a same-named
   * category in another tenant would file the ticket somewhere nobody chose.
   */
  const lastCustomer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (lastCustomer.current === customerId) return;
    const firstFill = lastCustomer.current === null;
    lastCustomer.current = customerId;
    if (firstFill) return; // preselecting the only customer is not a change
    // The project always goes: it belonged to the other tenant by definition.
    setProjectId(null);
    // The category only if it went stale. Most are SHARED and survive the
    // switch, and clearing a still-valid choice would make the field flicker
    // back to the first option for no reason the person can see.
    setCategoryId((current) =>
      current != null && categories.some((c) => c.id === current) ? current : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

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
    setCategoryId(null);
    setProjectId(null);
    // Leave the customer alone: with one it is already right, and with several
    // the person is about to choose. Resetting it here would clear a preselect
    // this same render just made.
    setFiles([]);
    setAttaching(false);
    setAttachError(null);
    createTicket.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the category once the list loads — but not before a customer is
  // chosen. The field is disabled until then, and a disabled control showing a
  // pre-picked value contradicts the placeholder sitting above it.
  React.useEffect(() => {
    if (customerId != null && categoryId == null && categories.length > 0) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId, customerId]);

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
        projectId,
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
      <div className="overflow-hidden rounded-panel bg-white shadow-modal">
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
            <div className="rounded-tile border border-accent-line bg-accent-soft px-3.5 py-3">
              <div className="mb-2 text-meta font-bold tracking-eyebrow text-brand-hover">
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
                    <span className="rounded bg-accent-edge px-1.5 py-0.5 font-mono text-counter font-semibold text-brand-hover">
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
          {/* Customer → Project, in that order and on their own row.
              One column below `sm` on purpose: at 375px a two-column split
              leaves each select about 110px, which is not a usable control —
              the same reason the row underneath stacks. */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="ticket-customer">{t("create.customer")}</Label>
              <select
                id="ticket-customer"
                value={customerId ?? ""}
                disabled={customerFixed}
                onChange={(e) =>
                  setCustomerId(e.target.value ? Number(e.target.value) : null)
                }
                className={cn(
                  "w-full rounded-md border border-edge bg-white px-3.5 py-2.5 text-ink",
                  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                  // Fixed rather than absent when there is only one: the field
                  // still says which company the ticket is for, which is worth
                  // seeing even when it cannot be changed.
                  customerFixed && "cursor-not-allowed bg-wash text-muted",
                  FIELD_TEXT_13,
                )}
              >
                {customerFixed ? null : (
                  <option value="">{t("create.customerChoose")}</option>
                )}
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {canPickProject ? (
              <div>
                <Label htmlFor="ticket-project">{t("create.project")}</Label>
                <select
                  id="ticket-project"
                  value={projectId ?? ""}
                  // Disabled, not merely empty: an enabled picker with nothing
                  // in it reads as "this customer has no projects", when the
                  // real answer is "choose a customer first".
                  disabled={customerId == null}
                  onChange={(e) =>
                    setProjectId(e.target.value ? Number(e.target.value) : null)
                  }
                  className={cn(
                    "w-full rounded-md border border-edge bg-white px-3.5 py-2.5 text-ink",
                    "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                    customerId == null && "cursor-not-allowed bg-wash text-muted",
                    FIELD_TEXT_13,
                  )}
                >
                  <option value="">
                    {customerId == null
                      ? t("create.projectPickCustomerFirst")
                      : projectsForCustomer.length === 0
                        ? t("create.projectNone")
                        : t("create.projectOptional")}
                  </option>
                  {projectsForCustomer.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="ticket-category">
                {t("create.category")} <span className="text-danger">*</span>
              </Label>
              <select
                id="ticket-category"
                value={categoryId ?? ""}
                disabled={customerId == null}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className={cn(
                  "w-full rounded-md border border-edge bg-white px-3.5 py-2.5 text-ink",
                  "focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15",
                  customerId == null && "cursor-not-allowed bg-wash text-muted",
                  FIELD_TEXT_13,
                )}
              >
                {/* Categories are scoped too, so this waits on the customer for
                    the same reason the project picker does. */}
                {customerId == null ? (
                  <option value="">{t("create.projectPickCustomerFirst")}</option>
                ) : null}
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
                "flex cursor-pointer flex-wrap items-center justify-center gap-1.5 rounded-tile border-[1.5px] border-dashed px-4 py-[18px] text-body transition-colors",
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
              accept={ATTACHMENT_ACCEPT}
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
