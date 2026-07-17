import { z } from "zod";

export const ticketIdParam = z.object({
  ticketId: z.coerce.number().int().positive(),
});

export const commentIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const createCommentBody = z.object({
  body: z.string().min(1),
  internal: z.boolean().optional().default(false),
});
