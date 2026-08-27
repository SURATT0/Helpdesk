"use client";

import { PRIORITY_META } from "@/lib/domain";
import type { Priority } from "@/lib/domain";
import { STATUS_META } from "@/lib/ticket-status";
import type { DisplayStatus, TicketStatusRecord } from "@/lib/ticket-status";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  caret,
  className,
}: {
  /**
   * Any status word that can be shown: a DisplayStatus off a ticket row, or the
   * older vocabulary a history row was written with.
   */
  status: DisplayStatus | TicketStatusRecord;
  caret?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-caption font-semibold",
        className,
      )}
      style={{ color: meta.fg, background: meta.bg }}
    >
      {t(`status.${status}`)}
      {caret ? <span className="ml-1">▾</span> : null}
    </span>
  );
}

export function PriorityIndicator({
  priority,
  caret,
  className,
  tone = "subtle",
}: {
  priority: Priority;
  caret?: boolean;
  className?: string;
  /**
   * The label's colour, as a prop rather than something a caller overrides
   * through `className`.
   *
   * `cn` joins class names, it does not merge them — so a caller passing
   * `text-ink` alongside this component's own colour left the winner to be
   * decided by the order Tailwind happens to emit the two rules in. That is
   * invisible until it flips: naming the colours as tokens reordered them and
   * silently repainted the properties rail's Priority value. One colour class
   * is emitted now, and the caller says which.
   */
  tone?: "subtle" | "ink";
}) {
  const { t } = useI18n();
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-body",
        tone === "ink" ? "text-ink" : "text-subtle",
        className,
      )}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: meta.dot }}
      />
      {t(`priority.${priority}`)}
      {caret ? <span className="text-faint">▾</span> : null}
    </span>
  );
}
