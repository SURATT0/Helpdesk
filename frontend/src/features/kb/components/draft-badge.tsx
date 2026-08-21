"use client";

import { useI18n } from "@/features/i18n/context";

/**
 * Marks an article nobody but its editors can see.
 *
 * Only people holding `kb:write` are ever sent drafts, so this badge never
 * reaches a reader — its whole job is to stop an author mistaking a draft for a
 * live article, which is easy to do when the two sit in the same list.
 */
export function DraftBadge() {
  const { t } = useI18n();
  return (
    <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
      {t("kb.draft")}
    </span>
  );
}
