import { z } from "zod";
import { prioritySchema } from "@/features/tickets/schemas";

export const reportsSummarySchema = z.object({
  data: z.object({
    kpis: z.object({
      avgHandlingHours: z.number(),
      medianFirstResponseMin: z.number(),
      slaCompliancePct: z.number(),
      handledCount: z.number(),
      judgedCount: z.number(),
    }),
    // Each bucket carries the day it counts, cut by the server's calendar — the
    // client no longer derives the axis from its own clock (see reports.repository).
    closureTrend: z.array(z.object({ day: z.string(), count: z.number() })),
    byPriority: z.array(
      z.object({
        priority: prioritySchema,
        compliancePct: z.number(),
        met: z.number(),
        breached: z.number(),
      }),
    ),
    byCategory: z.array(
      z.object({
        category: z.string(),
        judged: z.number(),
        met: z.number(),
        breached: z.number(),
        compliancePct: z.number(),
      }),
    ),
  }),
});

export type ReportsSummary = z.infer<typeof reportsSummarySchema>["data"];

/**
 * Per-agent throughput — its own document, from its own endpoint.
 *
 * It used to be a `byAgent` field on the summary above, which meant the object
 * every reader of the reports page held in memory contained a table of who works
 * how fast. Keeping it in a separate type is what lets the page never fetch it
 * at all for a reader who may not see it: there is no field to leave undefined
 * and no branch that could forget to.
 */
export const agentWorkloadSchema = z.object({
  data: z.array(
    z.object({
      /** Ids, not names: two people can share a name, and "is this me?" is an id question. */
      agentId: z.number(),
      agent: z.string(),
      handled: z.number(),
      avgHandlingHours: z.number(),
    }),
  ),
});

export type AgentWorkload = z.infer<typeof agentWorkloadSchema>["data"][number];
