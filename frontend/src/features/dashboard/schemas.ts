import { z } from "zod";
import { displayStatusSchema, prioritySchema } from "@/features/tickets/schemas";

export const dashboardSummarySchema = z.object({
  data: z.object({
    stats: z.object({
      totalTickets: z.number(),
      openTickets: z.number(),
      unassigned: z.number(),
      closedThisWeek: z.number(),
      avgResolutionHours: z.number(),
      /** Past their target and still open. Disjoint from `slaDueSoon`. */
      slaBreached: z.number(),
      /** Not past it yet, and inside the due-soon window. */
      slaDueSoon: z.number(),
    }),
    byStatus: z.array(
      z.object({ status: displayStatusSchema, count: z.number() }),
    ),
    openByPriority: z.array(
      z.object({ priority: prioritySchema, count: z.number() }),
    ),
  }),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>["data"];
