"use client";

import { BADGE, type BadgePair } from "@/lib/badge-pairs";
import { useI18n } from "@/features/i18n/context";
import type { ProblemStatus } from "../schemas";

/**
 * Problem status pill. Its own MAPPING rather than reusing the ticket status
 * one: a problem's lifecycle is not a ticket's, and pointing this at
 * STATUS_META would imply an equivalence that doesn't exist. The pairs it picks
 * from are shared, which is a different claim — that a "done and it worked"
 * badge is the same green wherever it appears.
 *
 * `known_error` is the one that matters day to day — it means a workaround is
 * documented — so it takes the warm pair rather than a neutral grey.
 */
const STYLE: Record<ProblemStatus, BadgePair> = {
  investigating: BADGE.sky,
  known_error: BADGE.amber,
  resolved: BADGE.green,
  closed: BADGE.slate,
};

export function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  const { t } = useI18n();
  const s = STYLE[status];
  return (
    <span
      className="inline-flex flex-none items-center rounded-full px-2 py-[2px] text-meta font-semibold"
      style={{ color: s.fg, background: s.bg }}
    >
      {t(`problemStatus.${status}`)}
    </span>
  );
}
