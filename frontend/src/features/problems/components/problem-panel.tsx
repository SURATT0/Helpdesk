"use client";

import * as React from "react";
import Link from "next/link";
import {
  BookOpen,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Pencil,
} from "lucide-react";
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
    user.role !== "user";

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
      return <span className="text-body text-faint">{t("problem.none")}</span>;
    }
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-dim px-2.5 py-1.5 text-dense font-semibold text-muted hover:border-faint hover:text-ink"
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
    <div className="rounded-[9px] border border-line bg-wash p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-body font-semibold leading-snug text-ink">
          {ticket.problem.title}
        </span>
        <ProblemStatusBadge status={ticket.problem.status as ProblemStatus} />
      </div>

      {full ? (
        <div className="mt-1.5 text-caption text-faint">
          {t("problem.linkedCount", { n: full.ticketCount })}
        </div>
      ) : null}

      {full?.workaround ? (
        // The reason a known error is worth linking: the fix is already known.
        <div className="mt-2 rounded-md border border-warn-edge bg-warn-tint p-2">
          <div className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-warn">
            {t("problem.workaround")}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-dense leading-relaxed text-[#78350f]">
            {full.workaround}
          </div>
        </div>
      ) : null}

      {/* The reason to link an article at all: from a ticket, one click to the
          documented steps. Sits directly under the workaround. */}
      {full?.kbArticle ? (
        <Link
          href={`/kb/${encodeURIComponent(full.kbArticle.id)}`}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1.5 text-caption font-semibold text-brand-hover hover:bg-app"
        >
          <BookOpen size={12} strokeWidth={2} className="flex-none" />
          <span className="min-w-0 flex-1 truncate">{full.kbArticle.title}</span>
          <ExternalLink size={11} className="flex-none text-faint" />
        </Link>
      ) : full?.kbArticleId ? (
        // An id that no longer resolves — say so rather than dropping it, so
        // whoever curates the KB can see the reference went stale.
        <div className="mt-2 flex items-start gap-1.5 text-caption text-warn">
          <BookOpen size={12} className="mt-px flex-none" />
          <span>{t("problem.kbMissing", { id: full.kbArticleId })}</span>
        </div>
      ) : null}

      {full?.rootCause ? (
        <div className="mt-2">
          <div className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-faint">
            {t("problem.rootCause")}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-dense leading-relaxed text-subtle">
            {full.rootCause}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 text-caption font-medium text-danger">
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
            className="inline-flex items-center gap-1.5 text-caption font-semibold text-muted hover:text-ink disabled:opacity-50"
          >
            <Pencil size={12} strokeWidth={2} />
            {full?.workaround ? t("problem.edit") : t("problem.addWorkaround")}
          </button>
          <button
            type="button"
            onClick={doUnlink}
            disabled={unlink.isPending}
            className="inline-flex items-center gap-1.5 text-caption font-semibold text-muted hover:text-ink disabled:opacity-50"
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
