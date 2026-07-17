"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Upload, X } from "lucide-react";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { uploadAttachment } from "@/features/attachments/api";
import { useKbSuggest } from "@/features/kb/queries";
import { useI18n } from "@/features/i18n/context";
import { useCategories, useCreateTicket } from "../queries";
import type { Priority } from "@/lib/domain";

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

const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

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
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Keep keyboard focus inside the dialog while it's open (basic focus trap).
  function trapFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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

  async function submit() {
    if (categoryId == null) return;
    setAttachError(null);
    try {
      const ticket = await createTicket.mutateAsync({
        subject: subject.trim(),
        description: description.trim(),
        categoryId,
        priority,
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
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center overflow-y-auto p-[44px]"
      style={{ background: "rgba(15,23,42,.45)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ticket-title"
        className="w-full max-w-[712px] overflow-hidden rounded-[14px] bg-white shadow-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="flex items-center justify-between border-b border-[#eef1f5] px-6 py-[18px]">
          <div>
            <div id="create-ticket-title" className="text-[16px] font-bold text-ink">
              {t("create.title")}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">
              {t("create.subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-[30px] w-[30px] place-items-center rounded-md border border-line text-muted hover:bg-app"
            aria-label={t("create.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-[22px]">
          <div>
            <Label htmlFor="ticket-subject">
              {t("create.subject")} <span className="text-[#dc2626]">*</span>
            </Label>
            <Input
              id="ticket-subject"
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("create.subjectPlaceholder")}
            />
          </div>

          {/* KB deflection — live suggestions from the subject */}
          {suggestions.length > 0 ? (
            <div className="rounded-[9px] border border-[#b4dcc3] bg-[#e4f2ea] px-3.5 py-3">
              <div className="mb-2 text-[11px] font-bold tracking-[0.06em] text-brand-hover">
                {t("create.suggested")}
              </div>
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                {suggestions.map((a) => (
                  <Link
                    key={a.id}
                    href={`/kb/${a.id}`}
                    target="_blank"
                    className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-[#d3ecdd]"
                  >
                    <span className="rounded-[4px] bg-[#d3ecdd] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-hover">
                      {a.id}
                    </span>
                    <span className="font-medium text-[#2f6b46]">{a.title}</span>
                    <span className="ml-auto whitespace-nowrap text-[11px] text-faint">
                      {t("kb.readMin", { n: a.readMin })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <Label htmlFor="ticket-category">
                {t("create.category")} <span className="text-[#dc2626]">*</span>
              </Label>
              <select
                id="ticket-category"
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(Number(e.target.value))}
                className="w-full rounded-md border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15"
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
                className="flex overflow-hidden rounded-md border border-[#e2e8f0] text-center text-[12.5px] font-medium"
              >
                {PRIORITIES.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={priority === p}
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 py-2.5",
                      i > 0 && "border-l border-[#e2e8f0]",
                      priority === p
                        ? "bg-[#e4f2ea] font-semibold text-brand-hover"
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
              {t("create.description")} <span className="text-[#dc2626]">*</span>
            </Label>
            <Textarea
              id="ticket-description"
              rows={3}
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
                "flex cursor-pointer flex-wrap items-center justify-center gap-1.5 rounded-[9px] border-[1.5px] border-dashed px-4 py-[18px] text-[12.5px] transition-colors",
                dragging
                  ? "border-brand bg-[#e4f2ea] text-brand-hover"
                  : "border-[#cbd5e1] bg-[#fafbfc] text-muted",
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
                    className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-[12px]"
                  >
                    <FileText
                      size={14}
                      strokeWidth={2}
                      className="flex-none text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-[#334155]">
                      {f.name}
                    </span>
                    <span className="flex-none text-[11px] text-faint">
                      {formatSize(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={t("create.remove", { name: f.name })}
                      className="flex-none text-faint hover:text-[#dc2626]"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {createTicket.isError ? (
            <div className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12.5px] font-medium text-[#b91c1c]">
              {createTicket.error instanceof ApiError
                ? createTicket.error.message
                : t("create.createError")}
            </div>
          ) : null}

          {attachError ? (
            <div className="rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12.5px] font-medium text-[#c2410c]">
              {attachError} — {t("create.attachErrorNote")}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
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
    </div>
  );
}
