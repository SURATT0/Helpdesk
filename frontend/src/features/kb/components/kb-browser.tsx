"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Clock, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { FIELD_TEXT_13 } from "@/components/ui/input";
import { useAuth } from "@/features/auth/context";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useKbArticles } from "../queries";
import { KbEditorModal } from "./kb-editor-modal";
import { DraftBadge } from "./draft-badge";

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-body",
        active
          ? "border-accent-line bg-accent-soft font-semibold text-brand-hover"
          : "border-line text-muted hover:border-faint",
      )}
    >
      {label}
    </button>
  );
}

export function KbBrowser() {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [writing, setWriting] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useKbArticles(q, category);

  // Mirrors the server’s kb:write grant (admin and up). A requester sees the
  // library read-only, which is the whole point of having one.
  const canWrite = user != null && user.role !== "user";

  const categories = data?.categories ?? [];
  const articles = data?.articles ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 focus-within:border-brand sm:max-w-[420px]">
          <Search size={14} strokeWidth={2} className="flex-none text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("kb.search")}
            className={cn(
              "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
              FIELD_TEXT_13,
            )}
          />
        </div>
        {canWrite ? (
          <Button onClick={() => setWriting(true)}>
            <Plus size={14} strokeWidth={2.5} />
            {t("kb.new")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <CategoryChip
          label={t("kb.all")}
          active={category === null}
          onClick={() => setCategory(null)}
        />
        {categories.map((c) => (
          <CategoryChip
            key={c}
            label={c}
            active={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      {isLoading ? (
        <LoadingRow />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : articles.length === 0 ? (
        <EmptyState message={t("kb.empty")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/kb/${a.id}`}
              className="group flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 transition-colors hover:border-brand"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-eyebrow font-semibold text-brand-hover">
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
              <div className="text-section font-semibold text-ink group-hover:text-brand-hover">
                {a.title}
              </div>
              <p className="line-clamp-2 text-body text-muted">{a.excerpt}</p>
              <span className="mt-auto inline-flex items-center gap-1 text-dense font-medium text-brand-hover">
                {t("kb.read")}
                <ChevronRight size={13} strokeWidth={2} />
              </span>
            </Link>
          ))}
        </div>
      )}

      {writing ? (
        <KbEditorModal
          onClose={() => setWriting(false)}
          // Straight to what was just written: an author almost always wants to
          // read it back, and a new draft is invisible in the list they came from.
          onCreated={(id) => router.push(`/kb/${id}`)}
        />
      ) : null}
    </div>
  );
}
