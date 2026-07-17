"use client";

import { useRouter } from "next/navigation";
import { PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { STATUS_META, type TicketStatus } from "@/lib/domain";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { matchesFilters, useSearch } from "../search-context";
import { slaColor, toneForName } from "../data";
import { useTickets } from "../queries";

const COLUMNS: TicketStatus[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];

export function TicketBoard() {
  const router = useRouter();
  const { t } = useI18n();
  const { query, statuses, priorities, assigneeMe } = useSearch();
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useTickets();

  if (isLoading) return <LoadingRow />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const tickets = (data?.tickets ?? []).filter((x) =>
    matchesFilters(
      x,
      { query, statuses, priorities, assigneeMe },
      user?.name ?? null,
    ),
  );

  return (
    <div className="flex gap-3 overflow-x-auto p-6">
      {COLUMNS.map((status) => {
        const col = tickets.filter((x) => x.status === status);
        const meta = STATUS_META[status];
        return (
          <div key={status} className="flex w-[264px] flex-none flex-col">
            <div className="mb-2.5 flex items-center gap-2 px-1 text-[12.5px] font-semibold text-ink">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: meta.fg }}
              />
              {t(`status.${status}`)}
              <span className="ml-auto rounded-full bg-[#f1f5f9] px-2 py-px font-mono text-[11px] font-semibold text-[#475569]">
                {col.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {col.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => router.push(`/tickets/${x.id}`)}
                  className="rounded-lg border border-line bg-panel p-3 text-left transition-colors hover:border-[#cbd5e1] hover:bg-[#fafbfc]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-medium text-muted">
                      #{x.id}
                    </span>
                    <span
                      className="font-mono text-[11px] font-medium"
                      style={{ color: slaColor[x.slaState] }}
                    >
                      {x.slaDue}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] font-medium text-ink">
                    {x.subject}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <PriorityIndicator priority={x.priority} />
                    {x.assignee ? (
                      <Avatar
                        name={x.assignee}
                        tone={toneForName(x.assignee)}
                        size={20}
                      />
                    ) : null}
                  </div>
                </button>
              ))}
              {col.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
                  —
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
