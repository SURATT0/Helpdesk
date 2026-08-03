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
  /** Filtering keys on this, not the display name — names are not unique. */
  assigneeId: z.number().nullable(),
  category: z.string(),
  slaDue: z.string(),
  slaState: slaStateSchema,
  attachments: z.number(),
  /**
   * The problem this incident is linked to, if any (many tickets → one problem).
   * The API has always returned it; it was previously dropped here because zod
   * strips unknown keys, so the UI could not show the link.
   */
  problem: z
    .object({ id: z.number(), title: z.string(), status: z.string() })
    .nullable(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
});

export const ticketListSchema = z.object({
  data: z.array(ticketSchema),
  meta: z.object({ total: z.number() }),
});

export const ticketEnvelopeSchema = z.object({ data: ticketSchema });

export const granularitySchema = z.enum(["week", "month", "year"]);

/**
 * The window the server resolved, echoed back on every history response. The
 * client labels the period from `start`/`end` and navigates with the anchors —
 * it never computes calendar boundaries itself, so "this month" can't drift
 * between the two sides.
 */
export const periodSchema = z.object({
  granularity: granularitySchema,
  start: z.string(),
  /** Exclusive: the first instant of the next period. */
  end: z.string(),
  prevAnchor: z.string(),
  nextAnchor: z.string(),
  /** The window contains now — the UI disables "newer" on it. */
  isCurrent: z.boolean(),
});

/**
 * One populated period offered by the picker. Carries its own window so the same
 * formatter labels it as labels the window on screen, and a count so the user can
 * see where the volume is before jumping.
 */
export const closedPeriodSchema = z.object({
  start: z.string(),
  end: z.string(),
  count: z.number(),
});

export const closedPeriodsSchema = z.object({
  data: z.array(closedPeriodSchema),
  meta: z.object({
    granularity: granularitySchema,
    returned: z.number(),
    limit: z.number(),
    /** The archive had more periods than the cap — the list is partial. */
    truncated: z.boolean(),
  }),
});

export const closedHistorySchema = z.object({
  data: z.array(ticketSchema),
  meta: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
    period: periodSchema,
  }),
});

export type Granularity = z.infer<typeof granularitySchema>;
export type Period = z.infer<typeof periodSchema>;
export type ClosedHistoryPage = z.infer<typeof closedHistorySchema>;
export type ClosedPeriod = z.infer<typeof closedPeriodSchema>;
export type ClosedPeriodsPage = z.infer<typeof closedPeriodsSchema>;

/**
 * Result of handing one person's queue to another. `remaining` is non-zero when
 * the queue was larger than one call's cap — the server reports the leftover
 * rather than truncating silently, so the UI can say "N still to move".
 */
export const reassignResultSchema = z.object({
  fromUserId: z.number(),
  toUserId: z.number().nullable(),
  statuses: z.array(ticketStatusSchema),
  movedTicketIds: z.array(z.number()),
  remaining: z.number(),
});

export const reassignEnvelopeSchema = z.object({ data: reassignResultSchema });

export type ReassignResult = z.infer<typeof reassignResultSchema>;

export type ReassignInput = {
  fromUserId: number;
  toUserId: number | null;
  /** Defaults server-side to the in-flight statuses; pass to override. */
  statuses?: z.infer<typeof ticketStatusSchema>[];
};

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
