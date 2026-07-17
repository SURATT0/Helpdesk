"use client";

import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { ApiError } from "@/lib/api-client";
import { useI18n } from "@/features/i18n/context";
import { useKbArticle } from "../queries";
import { KbBody } from "../render";

export function KbArticleView({ id }: { id: string }) {
  const { t } = useI18n();
  const { data: a, isLoading, isError, error, refetch } = useKbArticle(id);

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
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 p-6">
      <Link
        href="/kb"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        {t("kb.back")}
      </Link>

      <div className="flex items-center gap-2">
        <span className="rounded-[4px] bg-[#e4f2ea] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-brand-hover">
          {a.id}
        </span>
        <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#475569]">
          {a.category}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-faint">
          <Clock size={11} strokeWidth={2} />
          {t("kb.readMin", { n: a.readMin })}
        </span>
      </div>

      <h1 className="text-[22px] font-bold tracking-[-0.01em] text-ink">
        {a.title}
      </h1>
      <div className="text-[11.5px] text-faint">
        {t("kb.updated")} {a.updatedAt}
      </div>

      <div className="rounded-lg border border-line bg-panel p-5">
        <KbBody body={a.body} />
      </div>
    </div>
  );
}
