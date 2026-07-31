"use client";

import { useI18n } from "@/features/i18n/context";
import type { ProblemStatus } from "../schemas";

/**
 * Problem status pill. Deliberately its own palette rather than reusing the
 * ticket status colours: a problem's lifecycle is not a ticket's, and sharing
 * the ticket palette would imply an equivalence that doesn't exist.
 * `known_error` is the one that matters day to day — it means a workaround is
 * documented — so it gets the warm colour rather than a neutral grey.
 */
const STYLE: Record<ProblemStatus, { fg: string; bg: string }> = {
  investigating: { fg: "#0369a1", bg: "#e0f2fe" },
  known_error: { fg: "#b45309", bg: "#fef3c7" },
  resolved: { fg: "#15803d", bg: "#dcfce7" },
  closed: { fg: "#475569", bg: "#f1f5f9" },
};

export function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  const { t } = useI18n();
  const s = STYLE[status];
  return (
    <span
      className="inline-flex flex-none items-center rounded-full px-2 py-[2px] text-[11px] font-semibold"
      style={{ color: s.fg, background: s.bg }}
    >
      {t(`problemStatus.${status}`)}
    </span>
  );
}
