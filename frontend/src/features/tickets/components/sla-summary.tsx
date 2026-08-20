"use client";

import * as React from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { useI18n } from "@/features/i18n/context";
import { cn } from "@/lib/utils";
import { matchesFilters, useSearch } from "../search-context";
import { judgeSla, type SlaState } from "../sla";
import { useSlaNow } from "../use-sla";
import { useTickets } from "../queries";

const TILES: {
  state: SlaState;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  className: string;
  activeClassName: string;
}[] = [
  {
    state: "breached_open",
    labelKey: "sla.summary.breachedOpen",
    icon: AlertTriangle,
    className: "border-sla-breach/40 bg-sla-breach/10 text-sla-breach-fg",
    activeClassName: "border-sla-breach bg-sla-breach text-white",
  },
  {
    state: "at_risk",
    labelKey: "sla.summary.atRisk",
    icon: Clock,
    className: "border-sla-risk-line/50 bg-sla-risk-bg text-sla-risk-fg",
    activeClassName: "border-sla-risk-fg bg-sla-risk-fg text-white",
  },
  {
    state: "breached_closed",
    labelKey: "sla.summary.breachedClosed",
    icon: AlertTriangle,
    className: "border-line bg-panel text-sla-breach-fg",
    activeClassName: "border-sla-breach-fg bg-sla-breach-fg text-white",
  },
];

/**
 * Three counts above the table, each a one-click filter.
 *
 * The counts follow the current filters — a queue filtered to one agent reports
 * that agent's breaches — with one deliberate exception: the SLA facet itself is
 * excluded from the count. Including it would zero the other two tiles the
 * moment one was clicked, and a summary you can only leave by clearing it is not
 * a summary.
 */
export function SlaSummary() {
  const { t } = useI18n();
  const { data } = useTickets();
  const { query, statuses, priorities, assignees, slaStates, setSlaOnly } =
    useSearch();
  const now = useSlaNow();

  const counts = React.useMemo(() => {
    const tally = new Map<SlaState, number>();
    const scope = { query, statuses, priorities, assignees };
    for (const x of data?.tickets ?? []) {
      if (!matchesFilters(x, scope, now)) continue;
      const { state } = judgeSla(x, now);
      tally.set(state, (tally.get(state) ?? 0) + 1);
    }
    return tally;
  }, [data, query, statuses, priorities, assignees, now]);

  const shown = TILES.filter((tile) => (counts.get(tile.state) ?? 0) > 0);
  // Nothing overdue and nothing about to be: say nothing rather than three zeros.
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-6">
      {shown.map((tile) => {
        const n = counts.get(tile.state) ?? 0;
        const active = slaStates.has(tile.state);
        const Icon = tile.icon;
        return (
          <button
            key={tile.state}
            type="button"
            aria-pressed={active}
            onClick={() => setSlaOnly(tile.state)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold",
              active ? tile.activeClassName : tile.className,
            )}
          >
            <Icon size={13} strokeWidth={2.5} />
            {t(tile.labelKey, { n })}
          </button>
        );
      })}
    </div>
  );
}
