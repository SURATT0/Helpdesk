"use client";

import * as React from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useI18n } from "@/features/i18n/context";
import { useUpdateProblem } from "../queries";
import { KbArticlePicker } from "./kb-article-picker";
import { PROBLEM_STATUSES, type Problem, type ProblemStatus } from "../schemas";

/**
 * Edit the investigation behind a problem.
 *
 * This is what makes `known_error` usable: until the PATCH endpoint existed,
 * `rootCause`, `workaround` and `status` were write-once at creation, so a
 * problem could never acquire the workaround its status promises.
 *
 * The server enforces "known_error requires a workaround" and returns a 400 with
 * a human message. This form mirrors the rule client-side to disable the save and
 * explain why, but never assumes its own copy is authoritative — the server's
 * message is what gets shown if the two ever disagree.
 */
export function EditProblemModal({
  problem,
  onClose,
}: {
  problem: Problem;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateProblem();

  const [title, setTitle] = React.useState(problem.title);
  const [status, setStatus] = React.useState<ProblemStatus>(problem.status);
  const [rootCause, setRootCause] = React.useState(problem.rootCause ?? "");
  const [workaround, setWorkaround] = React.useState(problem.workaround ?? "");
  const [kbArticleId, setKbArticleId] = React.useState(problem.kbArticleId);
  const [error, setError] = React.useState<string | null>(null);

  const needsWorkaround =
    status === "known_error" && workaround.trim().length === 0;

  function submit() {
    setError(null);
    update.mutate(
      {
        id: problem.id,
        input: {
          title: title.trim(),
          status,
          // Empty means "clear it", which the API expresses as null.
          rootCause: rootCause.trim() || null,
          workaround: workaround.trim() || null,
          kbArticleId,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : t("problem.editError"),
          ),
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("problem.editTitle")}
    >
      <div className="flex max-h-[85vh] w-full max-w-[540px] flex-col overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">
              {t("problem.editTitle")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#475569]">
              {t("problem.editNote", { n: problem.ticketCount })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("problem.close")}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="ep-title">
              {t("problem.titleLabel")}
            </label>
            <input
              id="ep-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="rounded-md border border-line bg-white px-3 py-[7px] text-[13px] text-ink focus:border-brand focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="ep-status">
              {t("problem.statusLabel")}
            </label>
            <select
              id="ep-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProblemStatus)}
              className="rounded-md border border-line bg-white px-2.5 py-[7px] text-[13px] text-ink focus:border-brand focus:outline-none"
            >
              {PROBLEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`problemStatus.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-[12px] font-medium text-faint"
              htmlFor="ep-workaround"
            >
              {t("problem.workaroundLabel")}
            </label>
            <textarea
              id="ep-workaround"
              value={workaround}
              onChange={(e) => setWorkaround(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={t("problem.workaroundPlaceholder")}
              className="resize-none rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            />
            <span className="text-[11.5px] text-faint">
              {t("problem.workaroundHelp")}
            </span>
          </div>

          {/* Sits with the workaround, not the root cause: both answer "how do
              I get this user working now", which is what a known error is for. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-faint">
              {t("problem.kbLabel")}
            </span>
            <KbArticlePicker value={kbArticleId} onChange={setKbArticleId} />
            <span className="text-[11.5px] text-faint">
              {t("problem.kbHelp")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-[12px] font-medium text-faint"
              htmlFor="ep-rootcause"
            >
              {t("problem.rootCauseLabel")}
            </label>
            <textarea
              id="ep-rootcause"
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder={t("problem.rootCausePlaceholder")}
              className="resize-none rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        {needsWorkaround ? (
          <div className="mt-3 flex items-start gap-1.5 rounded-md border border-[#fde68a] bg-[#fffbeb] p-2.5 text-[12px] font-medium text-[#b45309]">
            <AlertTriangle size={13} className="mt-px flex-none" />
            <span>{t("problem.knownErrorNeedsWorkaround")}</span>
          </div>
        ) : null}

        {error ? (
          <div className="mt-2.5 text-[12.5px] font-medium text-[#dc2626]">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("problem.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={
              needsWorkaround || title.trim().length === 0 || update.isPending
            }
          >
            {update.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t("problem.saving")}
              </>
            ) : (
              t("problem.save")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
