"use client";

import type { Lang } from "@/features/i18n/dictionary";
import { useLanguagePreference } from "@/features/i18n/use-language-preference";
import { cn } from "@/lib/utils";

const LABELS: Record<Lang, string> = { en: "EN", th: "ไทย" };

export function LanguageToggle() {
  // Not `useI18n().setLang` directly: a signed-in change has to reach the
  // account too, because that is what the desk's email is written in.
  const { lang, setLanguage } = useLanguagePreference();
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line text-dense font-semibold">
      {(["en", "th"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLanguage(l)}
          aria-pressed={lang === l}
          className={cn(
            // Grows vertically on a touch screen: 26px tall is well under the
            // 44px floor, and unlike the icon buttons this is a segmented pair
            // whose width is set by its label.
            "px-2 py-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5",
            lang === l ? "bg-brand text-white" : "text-muted hover:bg-app",
          )}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
