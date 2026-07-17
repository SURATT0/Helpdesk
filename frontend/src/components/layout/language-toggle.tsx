"use client";

import { useI18n } from "@/features/i18n/context";
import type { Lang } from "@/features/i18n/dictionary";
import { cn } from "@/lib/utils";

const LABELS: Record<Lang, string> = { en: "EN", th: "ไทย" };

export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line text-[12px] font-semibold">
      {(["en", "th"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={cn(
            "px-2 py-1",
            lang === l ? "bg-brand text-white" : "text-muted hover:bg-app",
          )}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
