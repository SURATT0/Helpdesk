import { z } from "zod";

/**
 * Query for the per-person workload read.
 *
 * `assigneeId` is optional and absence means "me" — not "everyone". The table
 * that compares people has its own route (`/workload/agents`) and its own gate,
 * so there is no parameter value here that widens the answer beyond one person.
 */
export const workloadQuery = z.object({
  assigneeId: z.coerce.number().int().positive().optional(),
});
