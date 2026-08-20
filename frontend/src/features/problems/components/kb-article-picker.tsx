"use client";

import * as React from "react";
import { BookOpen, Check, Loader2, Search, X } from "lucide-react";
import { FIELD_TEXT_12 } from "@/components/ui/input";
import { useI18n } from "@/features/i18n/context";
import { useKbArticles } from "@/features/kb/queries";
import { cn } from "@/lib/utils";

/**
 * Pick the knowledge-base article that documents a known error.
 *
 * Search-driven rather than a `<select>` of every article: the KB grows, and an
 * agent looking for "the Outlook password one" wants to type that, not scroll.
 * Reuses the existing `/kb` list endpoint — the picker adds no new API surface.
 */
export function KbArticlePicker({
  value,
  onChange,
}: {
  /** Currently selected article id, or null. */
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const { data, isLoading } = useKbArticles(query, null);
  const articles = data?.articles ?? [];

  const selected = articles.find((a) => a.id === value);

  return (
    <div className="flex flex-col gap-1.5">
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-[#fafbfc] px-2.5 py-2">
          <BookOpen size={13} className="flex-none text-brand" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
            {/* The title may not be in the current search results; fall back to
                the id so the selection is never rendered as blank. */}
            {selected ? selected.title : value}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("problem.kbClear")}
            className="grid h-5 w-5 flex-none place-items-center rounded text-[#475569] hover:bg-app"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-white px-2.5 py-[6px] focus-within:border-brand">
        <Search size={12} className="flex-none text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("problem.kbSearchPlaceholder")}
          className={cn(
            "w-full min-w-0 bg-transparent text-ink placeholder:text-faint focus:outline-none",
            FIELD_TEXT_12,
          )}
        />
      </div>

      <div className="max-h-[132px] overflow-y-auto rounded-md border border-line">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-3 text-[12px] text-faint">
            <Loader2 size={12} className="animate-spin" />
            {t("common.loading")}
          </div>
        ) : articles.length === 0 ? (
          <div className="p-3 text-center text-[12px] text-faint">
            {t("problem.kbNoneFound")}
          </div>
        ) : (
          articles.map((a, i) => {
            const active = a.id === value;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(active ? null : a.id)}
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-app",
                  i < articles.length - 1 && "border-b border-[#f1f4f8]",
                  active && "bg-[#e4f2ea]",
                )}
              >
                <span
                  className={cn(
                    "mt-[3px] grid h-3.5 w-3.5 flex-none place-items-center rounded-[4px] border",
                    active ? "border-brand bg-brand text-white" : "border-[#cbd5e1]",
                  )}
                >
                  {active ? <Check size={10} strokeWidth={3.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">
                    {a.title}
                  </span>
                  <span className="block text-[11px] text-faint">
                    {a.id} · {a.category}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
