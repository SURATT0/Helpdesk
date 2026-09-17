import type { Priority } from "../../shared/domain";
import {
  DISPLAY_STATUSES,
  getDisplayStatus,
  type DisplayStatus,
  type TicketStatus,
} from "../../shared/ticket-status";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { ticketScopeWhere } from "../tickets/ticket.scope";

// Work still on the desk. One value now: New and In Progress are both `new`,
// and `pending` is finished work waiting on the requester.
const ACTIVE: TicketStatus[] = ["new"];
const ALL_PRIORITY: Priority[] = ["critical", "high", "medium", "low"];
const HOUR = 3_600_000;

export type DashboardSummary = {
  stats: {
    totalTickets: number;
    openTickets: number;
    unassigned: number;
    closedThisWeek: number;
    avgResolutionHours: number;
    slaAtRisk: number;
    slaBreachUnder1h: number;
  };
  byStatus: { status: DisplayStatus; count: number }[];
  openByPriority: { priority: Priority; count: number }[];
};

export const dashboardRepository = {
  async getSummary(now: Date, user: AuthUser): Promise<DashboardSummary> {
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
    // Every aggregate is scoped to the tickets this user may see, so managers
    // see their department, agents their team, requesters their own.
    const scope = ticketScopeWhere(user);

    const [total, grouped, active, resolved, closedThisWeek] =
      await Promise.all([
        prisma.ticket.count({ where: scope }),
        // Grouped by the two columns the DISPLAYED status is derived from, not by
        // status alone: New and In Progress are the same stored value, so a
        // group-by on status could never tell those two bars apart.
        prisma.ticket.groupBy({
          by: ["status", "assigneeId"],
          where: scope,
          _count: { _all: true },
        }),
        prisma.ticket.findMany({
          where: { AND: [scope, { status: { in: ACTIVE } }] },
          select: { priority: true, assigneeId: true, dueAt: true },
        }),
        prisma.ticket.findMany({
          where: { AND: [scope, { resolvedAt: { not: null } }] },
          select: { createdAt: true, resolvedAt: true },
        }),
        /**
         * Tickets CLOSED in the last seven days.
         *
         * Both halves of this are load-bearing. It counted `resolvedAt` alone,
         * which is stamped on the first arrival at `pending` — the desk saying
         * the work is done, before the requester has answered — so the tile read
         * "closed this week" while counting tickets nobody had closed. The
         * reports page had already moved its closure trend off that column for
         * the same reason; this is the KPI that did not follow.
         *
         * And `closedAt` on its own is not enough either: it is stamped on the
         * move into `closed` and deliberately never cleared, because the 30-day
         * reopen check reads it back. So a reopened ticket still carries the
         * timestamp of its earlier closure and would be counted here while
         * sitting in the New column two tiles away. Requiring the status too is
         * exactly what `findClosed` does for the closed-ticket log, and for
         * exactly this reason.
         *
         * `cancelled` needs no exclusion: a withdrawal leaves `closedAt` null,
         * because the work never happened.
         */
        prisma.ticket.count({
          where: {
            AND: [scope, { status: "closed", closedAt: { gte: weekAgo } }],
          },
        }),
      ]);

    const statusCount = new Map<DisplayStatus, number>();
    for (const g of grouped) {
      const key = getDisplayStatus(g);
      statusCount.set(key, (statusCount.get(key) ?? 0) + g._count._all);
    }
    const byStatus = DISPLAY_STATUSES.map((status) => ({
      status,
      count: statusCount.get(status) ?? 0,
    }));

    const priorityCount = new Map<Priority, number>();
    for (const t of active) {
      priorityCount.set(t.priority, (priorityCount.get(t.priority) ?? 0) + 1);
    }
    const openByPriority = ALL_PRIORITY.map((priority) => ({
      priority,
      count: priorityCount.get(priority) ?? 0,
    }));

    const resHours = resolved
      .filter((t) => t.resolvedAt)
      .map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / HOUR);
    const avgResolutionHours = resHours.length
      ? Math.round((resHours.reduce((a, b) => a + b, 0) / resHours.length) * 10) / 10
      : 0;

    const t1h = now.getTime() + HOUR;
    const t4h = now.getTime() + 4 * HOUR;
    const slaAtRisk = active.filter(
      (t) => t.dueAt && t.dueAt.getTime() > now.getTime() && t.dueAt.getTime() <= t4h,
    ).length;
    const slaBreachUnder1h = active.filter(
      (t) => t.dueAt && t.dueAt.getTime() <= t1h,
    ).length;

    return {
      stats: {
        totalTickets: total,
        openTickets: active.length,
        unassigned: active.filter((t) => t.assigneeId == null).length,
        closedThisWeek,
        avgResolutionHours,
        slaAtRisk,
        slaBreachUnder1h,
      },
      byStatus,
      openByPriority,
    };
  },
};
