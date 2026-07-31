"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { toneForName } from "@/features/tickets/data";
import { useReassignTickets } from "@/features/tickets/queries";
import type { ReassignResult } from "@/features/tickets/schemas";
import { useI18n } from "@/features/i18n/context";
import type { User } from "../schemas";

/**
 * Hand one person's whole queue to someone else — the "agent is on leave / has
 * left" case, where reassigning ticket by ticket is the wrong tool.
 *
 * The server decides WHICH tickets move (in-flight statuses only, within the
 * caller's row scope) and caps one call, reporting any leftover. This dialog
 * only picks the destination and reports back what actually happened, including
 * a partial move — a queue larger than the cap is a real outcome the user needs
 * to see, not something to hide behind a spinner.
 */
export function HandoverQueueModal({
  from,
  candidates,
  onClose,
}: {
  from: User;
  /** Staff who could receive the queue; the server re-checks eligibility. */
  candidates: User[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const reassign = useReassignTickets();
  const [toUserId, setToUserId] = React.useState<number | "none" | "">("");
  const [result, setResult] = React.useState<ReassignResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const eligible = React.useMemo(
    () => candidates.filter((u) => u.id !== from.id && u.role !== "requester"),
    [candidates, from.id],
  );

  function submit() {
    if (toUserId === "") return;
    setError(null);
    reassign.mutate(
      { fromUserId: from.id, toUserId: toUserId === "none" ? null : toUserId },
      {
        onSuccess: (r) => setResult(r),
        onError: (err) =>
          setError(
            err instanceof ApiError ? err.message : t("handover.error"),
          ),
      },
    );
  }

  const moved = result?.movedTicketIds.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("handover.title")}
    >
      <div className="w-full max-w-[440px] rounded-xl border border-line bg-panel p-5 shadow-modal">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">
              {t("handover.title")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#475569]">
              {t("handover.note")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("handover.close")}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-line text-[#475569] hover:bg-app"
          >
            <X size={14} />
          </button>
        </div>

        {result ? (
          <div className="mt-4">
            <div className="rounded-lg border border-line bg-[#fafbfc] p-3 text-[13px]">
              <div className="font-semibold text-ink">
                {t("handover.movedCount", { n: moved })}
              </div>
              {result.remaining > 0 ? (
                // Not a silent truncation: the queue was bigger than one call.
                <div className="mt-1.5 flex items-start gap-1.5 text-[12px] font-medium text-[#b45309]">
                  <AlertTriangle size={13} className="mt-px flex-none" />
                  <span>{t("handover.remaining", { n: result.remaining })}</span>
                </div>
              ) : null}
              <div className="mt-1.5 text-[11.5px] text-faint">
                {t("handover.statusNote", {
                  statuses: result.statuses.join(", "),
                })}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose}>{t("handover.done")}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-line bg-[#fafbfc] p-3">
              <Avatar name={from.name} tone={toneForName(from.name)} size={28} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[13px] font-semibold text-ink">
                  {from.name}
                </div>
                <div className="truncate text-[11.5px] text-faint">
                  {from.email}
                </div>
              </div>
              <ArrowRight size={15} className="mx-1 flex-none text-faint" />
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="handover-to">
                  {t("handover.to")}
                </label>
                <select
                  id="handover-to"
                  value={toUserId === "" ? "" : String(toUserId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setToUserId(v === "" ? "" : v === "none" ? "none" : Number(v));
                  }}
                  className="w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[12.5px] text-ink"
                >
                  <option value="">{t("handover.choose")}</option>
                  <option value="none">{t("handover.unassign")}</option>
                  {eligible.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.availableForAssignment ? "" : ` (${t("users.away")})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? (
              <div className="mt-2.5 text-[12.5px] font-medium text-[#dc2626]">
                {error}
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t("handover.cancel")}
              </Button>
              <Button
                onClick={submit}
                disabled={toUserId === "" || reassign.isPending}
              >
                {reassign.isPending ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {t("handover.moving")}
                  </>
                ) : (
                  t("handover.confirm")
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
