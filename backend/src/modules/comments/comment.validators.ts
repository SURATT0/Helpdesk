import { z } from "zod";
import { freeText, TEXT_MAX } from "../../shared/text";

export const ticketIdParam = z.object({
  ticketId: z.coerce.number().int().positive(),
});

export const commentIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const createCommentBody = z.object({
  body: freeText({ max: TEXT_MAX.BODY }),
  internal: z.boolean().optional().default(false),
});

export const markReadBody = z.object({
  lastReadId: z.coerce.number().int().positive(),
});
