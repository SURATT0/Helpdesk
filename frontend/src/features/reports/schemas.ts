import { z } from "zod";
import { prioritySchema } from "@/features/tickets/schemas";

export const reportsSummarySchema = z.object({
  data: z.object({
    kpis: z.object({
      avgResolutionHours: z.number(),
      medianFirstResponseMin: z.number(),
      slaCompliancePct: z.number(),
      resolvedCount: z.number(),
      judgedCount: z.number(),
    }),
    resolutionTrend: z.array(z.number()),
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
        resolved: z.number(),
        avgResolutionHours: z.number(),
      }),
    ),
  }),
});

export type ReportsSummary = z.infer<typeof reportsSummarySchema>["data"];
