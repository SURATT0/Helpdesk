"use client";

import { useRouter } from "next/navigation";
import { PriorityIndicator } from "@/components/ui/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { DISPLAY_STATUSES, STATUS_META } from "@/lib/ticket-status";
import { useI18n } from "@/features/i18n/context";
import { useAuth } from "@/features/auth/context";
import { matchesFilters, useSearch } from "../search-context";
import { toneForName } from "../data";
import { SlaBadge } from "./sla-badge";
import { useAssessSla } from "../use-sla";
import { useTickets } from "../queries";

const COLUMNS = DISPLAY_STATUSES;

export function TicketBoard() {
  const router = useRouter();
  const { t } = useI18n();
  // Includes the SLA facet: the board has no filter bar of its own, so a filter
  // set in the list view must keep applying when the view is switched — not
  // silently drop the one facet the board doesn't draw a chip for.
  const { query, statuses, priorities, assignees, slaStates } = useSearch();
  const { data, isLoading, isError, refetch } = useTickets();
  // Before the early returns below — it holds a ticking clock, and a hook that
  // only runs on some renders is not a hook.
  const assess = useAssessSla();

  if (isLoading) return <LoadingRow />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const tickets = (data?.tickets ?? []).filter((x) =>
    matchesFilters(x, { query, statuses, priorities, assignees, slaStates }),
  );

  return (
    <div className="flex gap-3 overflow-x-auto p-4 sm:p-6">
      {COLUMNS.map((status) => {
        const col = tickets.filter((x) => x.displayStatus === status);
        const meta = STATUS_META[status];
        return (
          <div key={status} className="flex w-[264px] flex-none flex-col">
            <div className="mb-2.5 flex items-center gap-2 px-1 text-body font-semibold text-ink">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: meta.fg }}
              />
              {t(`status.${status}`)}
              <span className="ml-auto rounded-full bg-fill px-2 py-px font-mono text-meta font-semibold text-subtle">
                {col.length}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {col.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => router.push(`/tickets/${x.id}`)}
                  className="rounded-lg border border-line bg-panel p-3 text-left transition-colors hover:border-dim hover:bg-wash"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-meta font-medium text-muted">
                      #{x.id}
                    </span>
                    <SlaBadge sla={assess(x)} />
                  </div>
                  <div className="mt-1 line-clamp-2 text-control font-medium text-ink">
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
                <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-caption text-faint">
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
