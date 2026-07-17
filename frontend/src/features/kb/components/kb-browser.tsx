"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Clock, Search } from "lucide-react";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { useKbArticles } from "../queries";

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
        "rounded-full border px-3 py-1.5 text-[12.5px]",
        active
          ? "border-[#b4dcc3] bg-[#e4f2ea] font-semibold text-brand-hover"
          : "border-line text-muted hover:border-[#94a3b8]",
      )}
    >
      {label}
    </button>
  );
}

export function KbBrowser() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useKbArticles(q, category);

  const categories = data?.categories ?? [];
  const articles = data?.articles ?? [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex w-full max-w-[420px] items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-[13px] focus-within:border-brand">
        <Search size={14} strokeWidth={2} className="flex-none text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("kb.search")}
          className="w-full bg-transparent text-ink placeholder:text-faint focus:outline-none"
        />
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
              <div className="text-[14px] font-semibold text-ink group-hover:text-brand-hover">
                {a.title}
              </div>
              <p className="line-clamp-2 text-[12.5px] text-muted">{a.excerpt}</p>
              <span className="mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-brand-hover">
                {t("kb.read")}
                <ChevronRight size={13} strokeWidth={2} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
