"use client";

import * as React from "react";
import { Link2, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { TOUCH_TARGET } from "@/components/ui/touch";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import { useLinkOrConvertProblem, useProblems } from "../queries";
import { ProblemStatusBadge } from "./problem-status-badge";

type Mode = "link" | "convert";

/**
 * Attach a ticket to a problem. Two ways in, one endpoint:
 *
 *   link    — this incident is another instance of a problem already being
 *             tracked. This is the path that makes "many incidents → one
 *             problem" work, so it is the default tab.
 *   convert — this incident IS the first sighting; promote it to a new problem.
 *
 * Linking is offered first deliberately: creating a second problem for something
 * already tracked is the mistake worth designing against, and the search list
 * makes the existing one visible before the user reaches for "new".
 */
export function LinkProblemModal({
  ticketId,
  ticketSubject,
  onClose,
}: {
  ticketId: number;
  ticketSubject: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<Mode>("link");
  const [search, setSearch] = React.useState("");
  const [title, setTitle] = React.useState(ticketSubject);
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const mutate = useLinkOrConvertProblem();
  const { data: problems = [], isLoading } = useProblems(
    { search: search.trim() || undefined, limit: 20 },
    { enabled: mode === "link" },
  );

  function submit(input: Parameters<typeof mutate.mutate>[0]["input"]) {
    setError(null);
    mutate.mutate(
      { ticketId, input },
      {
        onSuccess: () => onClose(),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("problem.error")),
      },
    );
  }

  const canConvert = title.trim().length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      label={t("problem.linkTitle")}
      panelClassName="max-w-[520px]"
    >
      <div className="flex max-h-[80dvh] flex-col rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">
              {t("problem.linkTitle")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#475569]">
              {t("problem.linkNote")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("problem.close")}
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app",
              TOUCH_TARGET,
            )}
          >
            <X size={14} />
          </button>
        </div>

        <div
          className="mb-3 flex gap-1 rounded-lg border border-line bg-[#fafbfc] p-1"
          role="tablist"
        >
          {(["link", "convert"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "flex-1 rounded-md bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink shadow-sm"
                  : "flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink"
              }
            >
              {m === "link" ? t("problem.tabLink") : t("problem.tabConvert")}
            </button>
          ))}
        </div>

        {mode === "link" ? (
          <>
            <div className="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-line bg-white px-3 py-[7px] focus-within:border-brand">
              <Search size={13} className="flex-none text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("problem.searchPlaceholder")}
                className={cn(
                  "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
                  FIELD_TEXT_13,
                )}
              />
            </div>

            <div className="min-h-[120px] flex-1 overflow-y-auto rounded-lg border border-line">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 p-6 text-[12.5px] text-faint">
                  <Loader2 size={14} className="animate-spin" />
                  {t("common.loading")}
                </div>
              ) : problems.length === 0 ? (
                <div className="p-6 text-center text-[12.5px] text-faint">
                  {t("problem.noneFound")}
                </div>
              ) : (
                problems.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={mutate.isPending}
                    onClick={() => submit({ problemId: p.id })}
                    className={
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-app disabled:opacity-50" +
                      (i < problems.length - 1
                        ? " border-b border-[#f1f4f8]"
                        : "")
                    }
                  >
                    <Link2 size={13} className="mt-1 flex-none text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {p.title}
                        </span>
                        <ProblemStatusBadge status={p.status} />
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-faint">
                        {t("problem.linkedCount", { n: p.ticketCount })}
                        {p.workaround
                          ? ` · ${t("problem.hasWorkaround")}`
                          : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2.5">
            <label className="text-[12px] font-medium text-faint" htmlFor="p-title">
              {t("problem.titleLabel")}
            </label>
            <input
              id="p-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={cn(
                "rounded-md border border-line bg-white px-3 py-[7px] text-ink focus:border-brand focus:outline-none",
                FIELD_TEXT_13,
              )}
            />
            <label className="text-[12px] font-medium text-faint" htmlFor="p-desc">
              {t("problem.descLabel")}
            </label>
            <textarea
              id="p-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={t("problem.descPlaceholder")}
              className={cn(
                "resize-none rounded-md border border-line bg-white px-3 py-2 text-ink placeholder:text-faint focus:border-brand focus:outline-none",
                FIELD_TEXT_13,
              )}
            />
          </div>
        )}

        {error ? (
          <div className="mt-2.5 text-[12.5px] font-medium text-[#dc2626]">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("problem.cancel")}
          </Button>
          {mode === "convert" ? (
            <Button
              onClick={() =>
                submit({
                  title: title.trim(),
                  description: description.trim() || null,
                })
              }
              disabled={!canConvert || mutate.isPending}
            >
              {mutate.isPending ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {t("problem.creating")}
                </>
              ) : (
                <>
                  <Plus size={13} />
                  {t("problem.createConfirm")}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
