"use client";

import { STATUS_META, PRIORITY_META } from "@/lib/domain";
import type { TicketStatus, Priority } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  caret,
  className,
}: {
  status: TicketStatus;
  caret?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold",
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
}: {
  priority: Priority;
  caret?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12.5px] text-[#475569]",
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
