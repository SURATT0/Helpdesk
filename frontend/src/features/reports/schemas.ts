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
    byAgent: z.array(
      z.object({
        agent: z.string(),
        handled: z.number(),
        avgHandlingHours: z.number(),
      }),
    ),
  }),
});

export type ReportsSummary = z.infer<typeof reportsSummarySchema>["data"];
