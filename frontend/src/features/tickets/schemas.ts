import { z } from "zod";

export const ticketStatusSchema = z.enum([
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
]);

export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const slaStateSchema = z.enum([
  "danger",
  "warn",
  "ok",
  "paused",
  "met",
]);

export const ticketSchema = z.object({
  id: z.number(),
  subject: z.string(),
  description: z.string(),
  status: ticketStatusSchema,
  priority: prioritySchema,
  requester: z.string(),
  requesterEmail: z.string(),
  assignee: z.string().nullable(),
  category: z.string(),
  slaDue: z.string(),
  slaState: slaStateSchema,
  attachments: z.number(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
});

export const ticketListSchema = z.object({
  data: z.array(ticketSchema),
  meta: z.object({ total: z.number() }),
});

export const ticketEnvelopeSchema = z.object({ data: ticketSchema });

export const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  defaultTeamId: z.number().nullable(),
});
export const categoryListSchema = z.object({ data: z.array(categorySchema) });

export const commentSchema = z.object({
  id: z.number(),
  body: z.string(),
  internal: z.boolean(),
  createdAt: z.string(),
  author: z.object({
    id: z.number(),
    name: z.string(),
    role: z.string(),
  }),
});
export const commentListSchema = z.object({ data: z.array(commentSchema) });
export const commentEnvelopeSchema = z.object({ data: commentSchema });

export const readMarkerSchema = z.object({
  userId: z.number(),
  name: z.string(),
  lastReadCommentId: z.number(),
});
export const readListSchema = z.object({ data: z.array(readMarkerSchema) });
export type ReadMarker = z.infer<typeof readMarkerSchema>;

export const replyResultSchema = z.object({
  comment: commentSchema,
  mail: z.object({
    transport: z.string(),
    to: z.string(),
    subject: z.string(),
    messageId: z.string().optional(),
  }),
});
export const replyResultEnvelope = z.object({ data: replyResultSchema });

export const historyEntrySchema = z.object({
  id: z.number(),
  fromStatus: ticketStatusSchema.nullable(),
  toStatus: ticketStatusSchema,
  actor: z.string().nullable(),
  createdAt: z.string(),
});
export const historyListSchema = z.object({
  data: z.array(historyEntrySchema),
});

export const importRowResultSchema = z.discriminatedUnion("ok", [
  z.object({ index: z.number(), ok: z.literal(true), ticketId: z.number() }),
  z.object({
    index: z.number(),
    ok: z.literal(false),
    field: z.string().nullable(),
    error: z.string(),
  }),
]);
export const importResultSchema = z.object({
  created: z.number(),
  failed: z.number(),
  results: z.array(importRowResultSchema),
});
export const importResultEnvelope = z.object({ data: importResultSchema });

export type Ticket = z.infer<typeof ticketSchema>;
export type ReplyResult = z.infer<typeof replyResultSchema>;
export type ImportRowResult = z.infer<typeof importRowResultSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type SlaState = z.infer<typeof slaStateSchema>;
export type Category = z.infer<typeof categorySchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** Client-only send state for optimistic chat messages (never sent by the API). */
export type CommentSendStatus = "sending" | "failed";

/**
 * A comment as held in the client cache. The base fields come from the API; the
 * optional `clientId`/`sendStatus` exist only while a locally-sent message is in
 * flight or has failed, so the thread can show it immediately (optimistic) with
 * a status and a retry affordance.
 */
export type Comment = z.infer<typeof commentSchema> & {
  clientId?: string;
  sendStatus?: CommentSendStatus;
};
