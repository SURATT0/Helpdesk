import type { Priority } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { ticketScopeWhere } from "../tickets/ticket.scope";

const ALL_PRIORITY: Priority[] = ["critical", "high", "medium", "low"];
const HOUR = 3_600_000;
const MIN = 60_000;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A date as `YYYY-MM-DD` in the server's local time.
 *
 * Built from the parts, not `toISOString().slice(0, 10)`: that converts to UTC
 * first, which would relabel the very buckets it is meant to describe on any
 * server not running UTC.
 */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type ReportsSummary = {
  kpis: {
    /**
     * Hours from the ticket being picked up to it reaching `closed`.
     *
     * Named "handling" rather than "resolution" because that is what it now
     * measures: the queue wait before anyone looked is excluded, and it ends at
     * the close rather than at the claim. The dashboard still carries an
     * `avgResolutionHours` of its own, measured raised → resolved — two names for
     * two different questions, which is the point.
     */
    avgHandlingHours: number;
    /** Minutes from the ticket being raised to the first status change. */
    medianFirstResponseMin: number;
    slaCompliancePct: number;
    /**
     * How many tickets the average above is drawn from — those that reached
     * `closed` AND were picked up at some point. A ticket closed without ever
     * changing status has no clock to measure.
     */
    handledCount: number;
    judgedCount: number;
  };
  /**
   * Tickets that reached `closed` on each of the last 7 days, oldest first.
   *
   * `day` is the bucket's own calendar day as `YYYY-MM-DD`, in the server's local
   * time — the same clock that cut the bucket. The client labels each bar from
   * this rather than recomputing the window, so the axis and the counts cannot
   * disagree about where a day starts.
   */
  closureTrend: { day: string; count: number }[];
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
};

/**
 * One person's throughput. Deliberately NOT part of `ReportsSummary` any more.
 *
 * It used to ride along in the SLA summary, which meant every caller of that
 * endpoint — a requester included — was handed a table naming each agent and
 * how long they take. Splitting it out is what lets the gate be a gate: the
 * summary now has no field that could carry it, so there is nothing for a
 * forgotten `if` to leak. See `maySeeTeamWorkload` in shared/auth.
 */
export type AgentWorkload = {
  /**
   * The assignee's id. The aggregate used to be keyed on the NAME, which merged
   * two people who happen to share one — and, more to the point here, left the
   * rows with nothing to check "is this me?" against.
   */
  agentId: number;
  agent: string;
  /** Tickets of theirs that reached `closed` — the set their average covers. */
  handled: number;
  avgHandlingHours: number;
};

/**
 * The first PUBLIC desk reply on every ticket in scope, oldest first.
 *
 * Extracted so the team's handling average and any one person's are drawn from
 * the SAME clock. They used to be computed side by side in one function, which
 * kept them honest by accident; now that they are two endpoints with two gates,
 * sharing this is what keeps "your average" and "the team's average" comparable
 * instead of two numbers that merely look alike.
 */
function firstDeskReplies(scope: ReturnType<typeof ticketScopeWhere>) {
  return prisma.comment.findMany({
    where: {
      internal: false,
      deletedAt: null,
      author: { role: { not: "user" } },
      ticket: scope,
    },
    orderBy: { createdAt: "asc" },
    select: {
      ticketId: true,
      createdAt: true,
      ticket: { select: { createdAt: true } },
    },
  });
}

/** When the desk first replied on each ticket, by ticket id. */
function openedAtByTicket(
  replies: { ticketId: number; createdAt: Date }[],
): Map<number, Date> {
  const openedAt = new Map<number, Date>();
  for (const h of replies) {
    if (!openedAt.has(h.ticketId)) openedAt.set(h.ticketId, h.createdAt);
  }
  return openedAt;
}

/**
 * Resolution time runs from the moment the ticket was opened to the moment it
 * reached `closed` — not from when it was raised, and not to when it was merely
 * marked resolved.
 *
 * Measuring from creation charged the team for the queue: a ticket raised at 2am
 * and picked up at 9 counted seven hours nobody could have worked. And
 * `resolved` is a claim, `closed` is the agreement — the requester confirming,
 * or the 72h auto-close standing in for them.
 *
 * The consequence, worth knowing when reading the number: a ticket resolved
 * correctly but left for the auto-close carries up to 72 hours of waiting in
 * this figure. That is real elapsed time to a requester, but it is not effort.
 */
function handlingHoursWith(openedAt: Map<number, Date>) {
  return (t: { id: number; closedAt: Date | null }): number | null => {
    const from = openedAt.get(t.id);
    if (!from || !t.closedAt) return null;
    return (t.closedAt.getTime() - from.getTime()) / HOUR;
  };
}

export const reportsRepository = {
  async getSlaSummary(now: Date, user: AuthUser): Promise<ReportsSummary> {
    // Scope every figure to the tickets this user may see.
    const scope = ticketScopeWhere(user);
    const [terminal, firstReplies] = await Promise.all([
      prisma.ticket.findMany({
        // Finished work. `pending` counts: the desk is done with it and the
        // resolution clock has stopped — only the requester has yet to confirm.
        where: { AND: [scope, { status: { in: ["pending", "closed"] } }] },
        // No `assignee` here, on purpose: this response is readable by everyone
        // who may read a ticket, so it must not be able to name who worked one.
        // Per-person figures come from `getAgentWorkload`, behind its own gate.
        select: {
          id: true,
          priority: true,
          createdAt: true,
          dueAt: true,
          resolvedAt: true,
          closedAt: true,
          category: { select: { name: true } },
        },
      }),
      /**
       * The first PUBLIC reply from the desk on each ticket — the moment someone
       * actually answered the person who asked.
       *
       * This used to be the first status transition, on the grounds that moving a
       * ticket off `new` was the moment it was picked up. That stopped being true
       * when In Progress became a derived state: taking a ticket is an assignment
       * now, which writes no history row, so the first transition on a ticket is
       * the one that FINISHES it — measuring to that would have reported the
       * handling time as nearly zero and the first response as the whole job.
       *
       * A reply is also the better answer to the question either figure asks. An
       * internal note is the desk talking to itself, and a note or a status move
       * is not something the requester ever sees, so neither is a response.
       */
      firstDeskReplies(scope),
    ]);

    const openedAt = openedAtByTicket(firstReplies);
    const handlingHours = handlingHoursWith(openedAt);

    const resHours = terminal
      .map(handlingHours)
      .filter((h): h is number => h != null);
    const avgHandlingHours = resHours.length
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

    const firstByTicket = new Map<number, number>();
    for (const h of firstReplies) {
      if (!firstByTicket.has(h.ticketId)) {
        firstByTicket.set(
          h.ticketId,
          (h.createdAt.getTime() - h.ticket.createdAt.getTime()) / MIN,
        );
      }
    }
    const medianFirstResponseMin = Math.round(median([...firstByTicket.values()]));

    /**
     * Closures per day over the last 7 days (oldest → newest), each bucket
     * carrying the day it counts.
     *
     * Counts `closed_at`, matching the handling average above. It counted
     * `resolved_at` before, which put a chart of one event directly under a KPI
     * measuring to another — the same ticket landed on a different day in each.
     *
     * The day travels with the count because the client used to derive its own
     * axis labels from `new Date()` in the browser. The buckets are cut here, in
     * the server's local time; the labels were cut there, in the reader's. A
     * closure at 03:00 in Bangkok on a UTC server therefore sat under yesterday's
     * bar while the label above it said today. One side has to own the calendar,
     * and it is the side doing the counting.
     */
    const closureTrend: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      closureTrend.push({
        day: localDay(start),
        count: terminal.filter(
          (t) =>
            t.closedAt &&
            t.closedAt.getTime() >= start.getTime() &&
            t.closedAt.getTime() < end.getTime(),
        ).length,
      });
    }

    return {
      kpis: {
        avgHandlingHours,
        medianFirstResponseMin,
        slaCompliancePct,
        handledCount: resHours.length,
        judgedCount: judged.length,
      },
      closureTrend,
      byPriority,
      byCategory,
    };
  },

  /**
   * Throughput per assignee, busiest first — the figures the workload gate
   * protects.
   *
   * `assigneeId` narrows it to one person. That is not an optimisation: it is how
   * "an agent may see their own numbers" is expressed at the layer that reads the
   * data, so a self-scoped call cannot accidentally compute anyone else's row and
   * then rely on a caller to drop it.
   *
   * Row scope still applies on top. A customer's own super_admin asking for the
   * whole table gets their own tenant's staff and no one else's, exactly as they
   * do everywhere else — the gate decides WHOSE numbers, `ticketScopeWhere`
   * decides WHICH tickets those numbers are drawn from.
   */
  async getAgentWorkload(
    user: AuthUser,
    assigneeId?: number,
  ): Promise<AgentWorkload[]> {
    const scope = ticketScopeWhere(user);
    const [terminal, firstReplies] = await Promise.all([
      prisma.ticket.findMany({
        where: {
          AND: [
            scope,
            { status: { in: ["pending", "closed"] } },
            // A ticket nobody holds has no one to credit; `assigneeId` narrows
            // to one person when the caller may only see themselves.
            assigneeId != null ? { assigneeId } : { assigneeId: { not: null } },
          ],
        },
        select: {
          id: true,
          closedAt: true,
          assigneeId: true,
          assignee: { select: { name: true } },
        },
      }),
      firstDeskReplies(scope),
    ]);

    const handlingHours = handlingHoursWith(openedAtByTicket(firstReplies));

    // Keyed on the id, not the name — two people called "J. Petrov" are two rows.
    const byId = new Map<number, { name: string; hours: number[] }>();
    for (const t of terminal) {
      const hrs = handlingHours(t);
      if (hrs == null || t.assigneeId == null || !t.assignee) continue;
      const row = byId.get(t.assigneeId) ?? { name: t.assignee.name, hours: [] };
      row.hours.push(hrs);
      byId.set(t.assigneeId, row);
    }

    return [...byId.entries()]
      .map(([agentId, row]) => ({
        agentId,
        agent: row.name,
        handled: row.hours.length,
        avgHandlingHours: round1(
          row.hours.reduce((a, b) => a + b, 0) / row.hours.length,
        ),
      }))
      .sort((a, b) => b.handled - a.handled);
  },
};
