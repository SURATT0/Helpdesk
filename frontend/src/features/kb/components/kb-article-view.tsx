"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { useKbArticle } from "../queries";
import { formatUpdated } from "../format";
import { KbBody } from "../render";
import { DraftBadge } from "./draft-badge";
import { KbDeleteDialog } from "./kb-delete-dialog";
import { KbEditorModal } from "./kb-editor-modal";

export function KbArticleView({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const { data: a, isLoading, isError, error, refetch } = useKbArticle(id);

  // Mirrors the server’s kb:write grant (admin and up), same as the browser.
  const canWrite = user != null && user.role !== "user";

  if (isLoading) return <LoadingRow label={`Loading ${id}…`} />;
  if (isError || !a) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        message={notFound ? t("kb.notFound") : t("common.loadError")}
        onRetry={notFound ? undefined : () => refetch()}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/kb"
          className="inline-flex items-center gap-1.5 text-body text-muted hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t("kb.back")}
        </Link>
        {canWrite ? (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil size={13} strokeWidth={2} />
              {t("kb.edit")}
            </Button>
            {/* Deliberately not styled red. `cn` is a plain join, so a text
                colour here would sit alongside the variant's own and let
                stylesheet order pick — and the emphasis belongs on the confirm
                button inside the dialog, not on the one that opens it. */}
            <Button size="sm" variant="outline" onClick={() => setDeleting(true)}>
              <Trash2 size={13} strokeWidth={2} />
              {t("kb.delete")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[4px] bg-accent-soft px-1.5 py-0.5 font-mono text-eyebrow font-semibold text-brand-hover">
          {a.id}
        </span>
        <span className="rounded-full bg-fill px-2 py-0.5 text-meta font-medium text-subtle">
          {a.category}
        </span>
        {a.status === "draft" ? <DraftBadge /> : null}
        <span className="ml-auto flex items-center gap-1 text-meta text-faint">
          <Clock size={11} strokeWidth={2} />
          {t("kb.readMin", { n: a.readMin })}
        </span>
      </div>

      <h1 className="text-hero font-bold tracking-[-0.01em] text-ink">
        {a.title}
      </h1>
      <div className="text-caption text-faint">
        {t("kb.updated")} {formatUpdated(a.updatedAt, lang)}
        {/* Attribution only where there is someone to attribute it to: the
            seeded library predates authors and shows the date alone. */}
        {a.author ? ` · ${t("kb.byline", { name: a.author.name })}` : null}
      </div>

      <div className="rounded-lg border border-line bg-panel p-5">
        <KbBody body={a.body} />
      </div>

      {editing ? (
        <KbEditorModal article={a} onClose={() => setEditing(false)} />
      ) : null}
      {deleting ? (
        <KbDeleteDialog
          id={a.id}
          title={a.title}
          onClose={() => setDeleting(false)}
          // The article this page is about no longer exists, so staying here
          // would show its own 404. Back to the library instead.
          onDeleted={() => router.replace("/kb")}
        />
      ) : null}
    </div>
  );
}
