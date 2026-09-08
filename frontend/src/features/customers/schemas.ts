import { z } from "zod";

/**
 * A tenant. The list is scoped server-side to the customers the caller reaches,
 * so it is safe to show whole and never contains more than that.
 */
export const customerSchema = z.object({
  id: z.number(),
  name: z.string(),
  /**
   * What is live under this tenant right now: live projects, OPEN tickets,
   * active users. Open rather than all tickets on purpose — a tenant whose work
   * is finished is exactly the one you archive, and counting closed ones would
   * make that impossible forever.
   *
   * Defaulted so a picker response that carries only id and name still parses.
   */
  counts: z
    .object({ projects: z.number(), tickets: z.number(), users: z.number() })
    .default({ projects: 0, tickets: 0, users: 0 }),
  createdAt: z.string().default(""),
});

/** What archiving would be refused for — the confirmation dialog's warning. */
export const archiveImpactSchema = z.object({
  id: z.number(),
  name: z.string(),
  projects: z.number(),
  tickets: z.number(),
  users: z.number(),
});

export const customerListSchema = z.object({ data: z.array(customerSchema) });
export const customerEnvelope = z.object({ data: customerSchema });
export const archiveImpactEnvelope = z.object({ data: archiveImpactSchema });

export type Customer = z.infer<typeof customerSchema>;
export type CustomerArchiveImpact = z.infer<typeof archiveImpactSchema>;
