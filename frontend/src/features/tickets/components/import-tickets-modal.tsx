"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { PRIORITIES_ASCENDING } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useCategories, useImportTickets } from "../queries";
import { parseImportCsv, IMPORT_COLUMNS, type ImportColumn } from "../csv";
import { DB_STATUSES } from "@/lib/ticket-status";
import type { ImportTicketRow } from "../api";
import type { ImportErrorReason } from "../schemas";

// Mildest first, like the create form: the same picker, over a parsed row.
const PRIORITIES = PRIORITIES_ASCENDING;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Draft = {
  subject: string;
  description: string;
  priority: string;
  category: string;
  requesterEmail: string;
  /**
   * Only present when the file carried a status column. Imported tickets always
   * start as New; this is read so a file naming a status the system does not
   * have (Open, Resolved) is refused with a reason rather than imported as
   * New behind the reader's back.
   */
  status?: string;
  /**
   * Why the server refused this row, as its code. The wording is built at render
   * time from this app's dictionary — the server's own `error` string is written
   * in English and would otherwise land in the middle of a Thai screen.
   */
  serverReason?: ImportErrorReason;
  /** The server's English sentence, kept only as a fallback (see `reasonText`). */
  serverError?: string;
};

const FIELDS: ImportColumn[] = [...IMPORT_COLUMNS];

/**
 * A small example file so the user knows the exact shape we expect.
 *
 * Both the category and the requester email come from the signed-in session, so
 * the template is importable as it stands. It used to name two seeded fixture
 * addresses, which a real customer downloading it would have had rejected as
 * unknown requesters — the one column where a placeholder cannot work, since the
 * server resolves it against the actual directory.
 */
function templateCsv(sampleCategory: string, sampleEmail: string): string {
  return [
    "subject,description,priority,category,requester email",
    `"VPN keeps dropping","Reconnects every 10 minutes after the 4.2 update",high,${sampleCategory},${sampleEmail}`,
    `"Cannot access shared drive","Lost access after the department move",medium,${sampleCategory},${sampleEmail}`,
  ].join("\n");
}

export function ImportTicketsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { data: categories = [] } = useCategories();
  const importTickets = useImportTickets();

  const [step, setStep] = React.useState<"upload" | "review" | "done">("upload");
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [createdTotal, setCreatedTotal] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  // Category names for the dropdown + a lowercase set for validation.
  const categoryNames = React.useMemo(
    () => categories.map((c) => c.name),
    [categories],
  );
  const categoryByLower = React.useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.name.toLowerCase(), c.name));
    return m;
  }, [categories]);

  React.useEffect(() => {
    if (!open) return;
    setStep("upload");
    setDrafts([]);
    setFileError(null);
    setBanner(null);
    setCreatedTotal(0);
    importTickets.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function loadFile(file: File | null | undefined) {
    if (!file) return;
    setFileError(null);
    file
      .text()
      .then((text) => {
        let parsed;
        try {
          parsed = parseImportCsv(text);
        } catch {
          setFileError(t("import.parseError"));
          return;
        }
        // Before anything else: a file that ended inside a quoted field has had
        // everything past that point folded into one cell. Whatever survives
        // would preview as a plausible short import, so say so instead.
        if (parsed.unterminatedQuote) {
          setFileError(t("import.unterminatedQuote"));
          return;
        }
        if (parsed.missingColumns.length > 0) {
          setFileError(
            t("import.missingColumns", {
              cols: parsed.missingColumns.join(", "),
            }),
          );
          return;
        }
        if (parsed.rows.length === 0) {
          setFileError(t("import.noRows"));
          return;
        }
        const cols = parsed.columns;
        const next: Draft[] = parsed.rows.map((row) => {
          const at = (c: ImportColumn) => {
            const i = cols[c];
            return i === undefined ? "" : (row[i] ?? "").trim();
          };
          const rawPriority = at("priority").toLowerCase();
          const rawCategory = at("category");
          return {
            subject: at("subject"),
            description: at("description"),
            priority: (PRIORITIES as readonly string[]).includes(rawPriority)
              ? rawPriority
              : rawPriority
                ? rawPriority // keep unknown value so it flags as invalid
                : "medium",
            // Normalise category to the canonical name; blank if unrecognised.
            category: categoryByLower.get(rawCategory.toLowerCase()) ?? "",
            requesterEmail: at("requesterEmail"),
            ...(cols.status === undefined ? {} : { status: at("status") }),
          };
        });
        setBanner(t("import.rowsFound", { n: next.length }));
        setDrafts(next);
        setStep("review");
      })
      .catch(() => setFileError(t("import.parseError")));
  }

  function fieldError(d: Draft, field: ImportColumn): string | null {
    const v = (d[field] ?? "").trim();
    switch (field) {
      case "subject":
        if (!v) return t("import.err.required");
        if (v.length < 3) return t("import.err.subjectMin");
        return null;
      case "description":
        return v ? null : t("import.err.required");
      case "priority":
        return (PRIORITIES as readonly string[]).includes(v)
          ? null
          : t("import.err.priority");
      case "category":
        if (!v) return t("import.err.required");
        return categoryByLower.has(v.toLowerCase())
          ? null
          : t("import.err.category");
      case "requesterEmail":
        if (!v) return t("import.err.required");
        return EMAIL_RE.test(v) ? null : t("import.err.email");
      case "status":
        // Absent or blank is the normal case — the column is optional.
        if (!v) return null;
        return (DB_STATUSES as readonly string[]).includes(v.toLowerCase())
          ? null
          : t("import.err.status");
    }
  }

  /**
   * A server rejection in the reader's language.
   *
   * The offending value is taken from the row still on screen rather than from
   * the response: it is the same string that was submitted, and reading it here
   * keeps the message in step if the row is edited. Falls back to the server's
   * own sentence only when the reason is one this bundle has no wording for.
   */
  function reasonText(d: Draft): string | null {
    switch (d.serverReason) {
      case "unknown_category":
        return t("import.srv.unknownCategory", { category: d.category });
      case "unknown_requester":
        return t("import.srv.unknownRequester", { email: d.requesterEmail });
      case "create_failed":
        return t("import.srv.failed");
      default:
        return d.serverError ?? null;
    }
  }

  const rowValid = (d: Draft) => FIELDS.every((f) => !fieldError(d, f));
  const invalidCount = drafts.filter((d) => !rowValid(d)).length;
  const busy = importTickets.isPending;
  const canSubmit = drafts.length > 0 && invalidCount === 0 && !busy;

  function updateDraft(idx: number, patch: Partial<Draft>) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === idx
          ? { ...d, ...patch, serverReason: undefined, serverError: undefined }
          : d,
      ),
    );
  }
  function removeRow(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    setBanner(null);
    const payload: ImportTicketRow[] = drafts.map((d) => ({
      subject: d.subject.trim(),
      description: d.description.trim(),
      priority: d.priority.trim() as ImportTicketRow["priority"],
      category: d.category.trim(),
      requesterEmail: d.requesterEmail.trim(),
      ...(d.status ? { status: d.status.trim() } : {}),
    }));
    try {
      const result = await importTickets.mutateAsync(payload);
      setCreatedTotal((n) => n + result.created);
      const failed = result.results.filter(
        (r): r is Extract<typeof r, { ok: false }> => !r.ok,
      );
      if (failed.length === 0) {
        setStep("done");
        return;
      }
      // Keep only the rejected rows, tagged with the server's reason, for retry.
      setDrafts(
        failed.map((r) => ({
          ...drafts[r.index],
          serverReason: r.reason,
          serverError: r.error,
        })),
      );
      setBanner(t("import.serverRejected", { n: failed.length }));
    } catch {
      // whole-request failure surfaced via importTickets.isError below
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="import-tickets-title"
      align="start"
      backdrop="bg-ink/45"
      padding="sm:p-[44px]"
      panelClassName="max-w-[920px]"
    >
      <div className="overflow-hidden rounded-[14px] bg-white shadow-modal">
        <div className="flex items-center justify-between border-b border-[#eef1f5] px-6 py-[18px]">
          <div>
            <div
              id="import-tickets-title"
              className="text-[16px] font-bold text-ink"
            >
              {t("import.title")}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">
              {t("import.subtitle")}
            </div>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-line text-muted hover:bg-app",
              TOUCH_TARGET,
            )}
            aria-label={t("create.close")}
          >
            <X size={14} />
          </button>
        </div>

        {/* ---- Upload step ---- */}
        {step === "upload" ? (
          <div className="flex flex-col gap-4 px-6 py-[22px]">
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
                loadFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[9px] border-[1.5px] border-dashed px-4 py-10 text-center text-[13px] transition-colors",
                dragging
                  ? "border-brand bg-[#e4f2ea] text-brand-hover"
                  : "border-[#cbd5e1] bg-[#fafbfc] text-muted",
              )}
            >
              <Upload size={22} strokeWidth={2} />
              <div>
                {t("import.dropText")}{" "}
                <span className="font-semibold text-brand-hover">
                  {t("import.browse")}
                </span>
              </div>
              <div className="text-[11.5px] text-faint">
                {t("import.formatHint")}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            {fileError ? (
              <div className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12.5px] font-medium text-[#b91c1c]">
                {fileError}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [
                    templateCsv(
                      categoryNames[0] ?? "General",
                      user?.email ?? "requester@example.com",
                    ),
                  ],
                  { type: "text/csv" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "ticket-import-template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="self-start text-[12.5px] font-medium text-brand hover:underline"
            >
              {t("import.template")}
            </button>
          </div>
        ) : null}

        {/* ---- Review step ---- */}
        {step === "review" ? (
          <>
            <div className="px-6 pt-4">
              {banner ? (
                <div className="mb-3 rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12.5px] font-medium text-[#c2410c]">
                  {banner}
                </div>
              ) : null}
              {importTickets.isError ? (
                <div className="mb-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12.5px] font-medium text-[#b91c1c]">
                  {importTickets.error instanceof ApiError
                    ? importTickets.error.message
                    : t("create.createError")}
                </div>
              ) : null}
            </div>
            <div className="max-h-[52vh] overflow-auto px-6">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                    <th className="w-8 pb-2" />
                    {FIELDS.map((f) => (
                      <th key={f} className="pb-2 pr-2">
                        {t(`import.col.${f}`)}
                      </th>
                    ))}
                    <th className="w-8 pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d, idx) => {
                    const errored = !rowValid(d) || !!reasonText(d);
                    return (
                      <tr
                        key={idx}
                        className={cn(
                          "border-t border-[#eef1f5] align-top",
                          errored && "bg-[#fef2f2]/40",
                        )}
                      >
                        <td className="py-1.5 pr-2 font-mono text-[11px] text-faint">
                          {idx + 1}
                        </td>
                        {FIELDS.map((f) => {
                          const err = fieldError(d, f);
                          return (
                            <td key={f} className="py-1.5 pr-2">
                              {f === "priority" ? (
                                <select
                                  value={
                                    (PRIORITIES as readonly string[]).includes(
                                      d.priority,
                                    )
                                      ? d.priority
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateDraft(idx, { priority: e.target.value })
                                  }
                                  className={cellClass(!!err)}
                                >
                                  <option value="">—</option>
                                  {PRIORITIES.map((p) => (
                                    <option key={p} value={p}>
                                      {t(`priority.${p}`)}
                                    </option>
                                  ))}
                                </select>
                              ) : f === "category" ? (
                                <select
                                  value={d.category}
                                  onChange={(e) =>
                                    updateDraft(idx, { category: e.target.value })
                                  }
                                  className={cellClass(!!err)}
                                >
                                  <option value="">—</option>
                                  {categoryNames.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={d[f]}
                                  onChange={(e) =>
                                    updateDraft(idx, { [f]: e.target.value })
                                  }
                                  className={cellClass(!!err)}
                                />
                              )}
                              {err ? (
                                <div className="mt-0.5 text-[10.5px] font-medium text-[#dc2626]">
                                  {err}
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="py-1.5">
                          <button
                            type="button"
                            onClick={() => removeRow(idx)}
                            aria-label={t("import.removeRow")}
                            className="text-faint hover:text-[#dc2626]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Per-row server rejection reasons */}
              {drafts.some((d) => reasonText(d)) ? (
                <div className="mt-2 flex flex-col gap-1 pb-2">
                  {drafts.map((d, i) => {
                    const reason = reasonText(d);
                    return reason ? (
                      <div
                        key={i}
                        className="text-[11px] text-[#b91c1c]"
                      >
                        <span className="font-mono">#{i + 1}</span> {reason}
                      </div>
                    ) : null;
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-6 py-4">
              <div
                className={cn(
                  "text-[12.5px] font-medium",
                  invalidCount > 0 ? "text-[#c2410c]" : "text-[#15803d]",
                )}
              >
                {invalidCount > 0
                  ? t("import.errorsRemain", { n: invalidCount })
                  : t("import.allValid", { n: drafts.length })}
              </div>
              <div className="flex gap-2.5">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep("upload");
                    setDrafts([]);
                    setBanner(null);
                    importTickets.reset();
                  }}
                >
                  {t("import.chooseAnother")}
                </Button>
                <Button onClick={submit} disabled={!canSubmit}>
                  {busy
                    ? t("import.importing")
                    : t("import.submit", { n: drafts.length })}
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {/* ---- Done step ---- */}
        {step === "done" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-[#dcfce7] text-[#15803d]">
              <CheckCircle2 size={30} />
            </div>
            <div className="text-[17px] font-bold text-ink">
              {t("import.resultTitle")}
            </div>
            <div className="text-[13px] text-muted">
              {t("import.created", { n: createdTotal })}
            </div>
            <Button
              className="mt-2"
              onClick={() => {
                onClose();
                router.push("/tickets");
              }}
            >
              {t("import.done")}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function cellClass(hasError: boolean): string {
  return cn(
    "w-full min-w-[120px] rounded border bg-white px-2 py-1.5 text-ink focus:outline-none focus:ring-[2px] focus:ring-brand/20",
    // Kept in step with the other fields even though this grid is a desk-only
    // surface: a field that zooms is worse than one whose text crowds its cell.
    FIELD_TEXT_12,
    hasError ? "border-[#fca5a5]" : "border-[#e2e8f0] focus:border-brand",
  );
}
