import { z } from "zod";

/**
 * Query params for the trail read. Everything is optional except the pagination
 * defaults; `limit` is capped so a single request can't pull the whole table.
 */
export const auditQuery = z
  .object({
    entity: z.string().min(1).max(40).optional(),
    entityId: z.coerce.number().int().positive().optional(),
    /** Prefix — "ticket" matches every `ticket.*` action. */
    action: z.string().min(1).max(60).optional(),
    userId: z.coerce.number().int().positive().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "`from` must not be after `to`",
    path: ["from"],
  });
