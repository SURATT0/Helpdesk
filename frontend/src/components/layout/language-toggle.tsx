"use client";

import { useI18n } from "@/features/i18n/context";
import type { Lang } from "@/features/i18n/dictionary";
import { cn } from "@/lib/utils";

const LABELS: Record<Lang, string> = { en: "EN", th: "ไทย" };

/**
 * Read this page in the other language — for this browser, for now.
 *
 * Session-scoped on purpose. It sits in the topbar AND on the login screen,
 * where there is nobody to attribute a choice to, so it cannot be the thing that
 * states a preference. Saying "my language is Thai" — the statement the mailer
 * reads, because it composes hours later with no browser to ask — is done on the
 * Settings page, which is where a person goes to change facts about themselves.
 *
 * Keeping it session-scoped also stops a glance in another language from
 * silently changing which language somebody's email arrives in.
 */
export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-line text-dense font-semibold">
      {(["en", "th"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
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
