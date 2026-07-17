import type { Priority } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { ticketScopeWhere } from "../tickets/ticket.scope";

const ALL_PRIORITY: Priority[] = ["critical", "high", "medium", "low"];
const HOUR = 3_600_000;
const MIN = 60_000;

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type ReportsSummary = {
  kpis: {
    avgResolutionHours: number;
    medianFirstResponseMin: number;
    slaCompliancePct: number;
    resolvedCount: number;
    judgedCount: number;
  };
  resolutionTrend: number[];
  byPriority: {
    priority: Priority;
    compliancePct: number;
    met: number;
    breached: number;
  }[];
  byCategory: {
    category: string;
    judged: number;
    met: number;
    breached: number;
    compliancePct: number;
  }[];
  byAgent: {
    agent: string;
    resolved: number;
    avgResolutionHours: number;
  }[];
};

export const reportsRepository = {
  async getSlaSummary(now: Date, user: AuthUser): Promise<ReportsSummary> {
    // Scope every figure to the tickets this user may see.
    const scope = ticketScopeWhere(user);
    const [terminal, firstTransitions] = await Promise.all([
      prisma.ticket.findMany({
        where: { AND: [scope, { status: { in: ["resolved", "closed"] } }] },
        select: {
          priority: true,
          createdAt: true,
          dueAt: true,
          resolvedAt: true,
          category: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
      // First status transition per ticket = a proxy for "first response".
      prisma.ticketStatusHistory.findMany({
        where: { fromStatus: { not: null }, ticket: scope },
        orderBy: { createdAt: "asc" },
        select: {
          ticketId: true,
          createdAt: true,
          ticket: { select: { createdAt: true } },
        },
      }),
    ]);

    const resHours = terminal
      .filter((t) => t.resolvedAt)
      .map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / HOUR);
    const avgResolutionHours = resHours.length
      ? round1(resHours.reduce((a, b) => a + b, 0) / resHours.length)
      : 0;

    // Only tickets with both a target and a resolution time can be judged.
    const judged = terminal.filter((t) => t.dueAt && t.resolvedAt);
    const isMet = (t: (typeof judged)[number]) =>
      t.resolvedAt!.getTime() <= t.dueAt!.getTime();
    const slaCompliancePct = judged.length
      ? round1((judged.filter(isMet).length / judged.length) * 100)
      : 0;

    const byPriority = ALL_PRIORITY.map((priority) => {
      const rows = judged.filter((t) => t.priority === priority);
      const met = rows.filter(isMet).length;
      return {
        priority,
        met,
        breached: rows.length - met,
        compliancePct: rows.length ? round1((met / rows.length) * 100) : 0,
      };
    });

    // SLA compliance grouped by category (over judged tickets), busiest first.
    const catMap = new Map<string, { met: number; total: number }>();
    for (const t of judged) {
      const name = t.category.name;
      const c = catMap.get(name) ?? { met: 0, total: 0 };
      c.total += 1;
      if (isMet(t)) c.met += 1;
      catMap.set(name, c);
    }
    const byCategory = [...catMap.entries()]
      .map(([category, c]) => ({
        category,
        judged: c.total,
        met: c.met,
        breached: c.total - c.met,
        compliancePct: c.total ? round1((c.met / c.total) * 100) : 0,
      }))
      .sort((a, b) => b.judged - a.judged);

    // Resolution throughput per assignee (resolved tickets only), busiest first.
    const agentMap = new Map<string, number[]>();
    for (const t of terminal) {
      if (!t.resolvedAt || !t.assignee) continue;
      const hrs = (t.resolvedAt.getTime() - t.createdAt.getTime()) / HOUR;
      const arr = agentMap.get(t.assignee.name) ?? [];
      arr.push(hrs);
      agentMap.set(t.assignee.name, arr);
    }
    const byAgent = [...agentMap.entries()]
      .map(([agent, hrs]) => ({
        agent,
        resolved: hrs.length,
        avgResolutionHours: round1(hrs.reduce((a, b) => a + b, 0) / hrs.length),
      }))
      .sort((a, b) => b.resolved - a.resolved);

    const firstByTicket = new Map<number, number>();
    for (const h of firstTransitions) {
      if (!firstByTicket.has(h.ticketId)) {
        firstByTicket.set(
          h.ticketId,
          (h.createdAt.getTime() - h.ticket.createdAt.getTime()) / MIN,
        );
      }
    }
    const medianFirstResponseMin = Math.round(median([...firstByTicket.values()]));

    // Resolutions per day over the last 7 days (oldest → newest).
    const resolutionTrend: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      resolutionTrend.push(
        terminal.filter(
          (t) =>
            t.resolvedAt &&
            t.resolvedAt.getTime() >= start.getTime() &&
            t.resolvedAt.getTime() < end.getTime(),
        ).length,
      );
    }

    return {
      kpis: {
        avgResolutionHours,
        medianFirstResponseMin,
        slaCompliancePct,
        resolvedCount: resHours.length,
        judgedCount: judged.length,
      },
      resolutionTrend,
      byPriority,
      byCategory,
      byAgent,
    };
  },
};
