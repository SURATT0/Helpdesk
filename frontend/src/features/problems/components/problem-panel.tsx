"use client";

import * as React from "react";
import { Link2, Link2Off, Loader2, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import type { Ticket } from "@/features/tickets/schemas";
import { useProblem, useUnlinkProblem } from "../queries";
import { EditProblemModal } from "./edit-problem-modal";
import { LinkProblemModal } from "./link-problem-modal";
import { ProblemStatusBadge } from "./problem-status-badge";
import type { ProblemStatus } from "../schemas";

/**
 * The problem link on a ticket, for the properties rail.
 *
 * When linked it shows the problem plus how many other incidents share it — the
 * "is this widespread?" signal — and its documented workaround, which is the
 * thing an agent actually needs mid-call. Root cause and workaround aren't on the
 * ticket payload (which carries only id/title/status), so the panel fetches the
 * problem directly.
 */
export function ProblemPanel({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const unlink = useUnlinkProblem();

  // Mirrors the server's problem:write grant (agent and up). Requesters see the
  // link read-only — it explains why their ticket is waiting on something bigger.
  const canWrite =
    user != null &&
    (user.role === "agent" || user.role === "manager" || user.role === "admin");

  const { data: full } = useProblem(ticket.problem?.id, {
    enabled: ticket.problem != null,
  });

  function doUnlink() {
    setError(null);
    unlink.mutate(ticket.id, {
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : t("problem.error")),
    });
  }

  if (!ticket.problem) {
    if (!canWrite) {
      return <span className="text-[12.5px] text-faint">{t("problem.none")}</span>;
    }
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#cbd5e1] px-2.5 py-1.5 text-[12px] font-semibold text-muted hover:border-[#94a3b8] hover:text-ink"
        >
          <Link2 size={12} strokeWidth={2} />
          {t("problem.linkAction")}
        </button>
        {open ? (
          <LinkProblemModal
            ticketId={ticket.id}
            ticketSubject={ticket.subject}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="rounded-[9px] border border-line bg-[#fafbfc] p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-ink">
          {ticket.problem.title}
        </span>
        <ProblemStatusBadge status={ticket.problem.status as ProblemStatus} />
      </div>

      {full ? (
        <div className="mt-1.5 text-[11.5px] text-faint">
          {t("problem.linkedCount", { n: full.ticketCount })}
        </div>
      ) : null}

      {full?.workaround ? (
        // The reason a known error is worth linking: the fix is already known.
        <div className="mt-2 rounded-md border border-[#fde68a] bg-[#fffbeb] p-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#b45309]">
            {t("problem.workaround")}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[#78350f]">
            {full.workaround}
          </div>
        </div>
      ) : null}

      {full?.rootCause ? (
        <div className="mt-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
            {t("problem.rootCause")}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[#475569]">
            {full.rootCause}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 text-[11.5px] font-medium text-[#dc2626]">
          {error}
        </div>
      ) : null}

      {canWrite ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          {/* Editing needs the full record (root cause, workaround), so it waits
              for the fetch rather than opening a form with blank fields. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={full == null}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-50"
          >
            <Pencil size={12} strokeWidth={2} />
            {full?.workaround ? t("problem.edit") : t("problem.addWorkaround")}
          </button>
          <button
            type="button"
            onClick={doUnlink}
            disabled={unlink.isPending}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted hover:text-ink disabled:opacity-50"
          >
            {unlink.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Link2Off size={12} strokeWidth={2} />
            )}
            {t("problem.unlink")}
          </button>
        </div>
      ) : null}

      {editing && full ? (
        <EditProblemModal problem={full} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
