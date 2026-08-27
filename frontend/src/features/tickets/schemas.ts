import { z } from "zod";
import { roleSchema } from "@/features/auth/schemas";
import { PRIORITIES } from "@/lib/domain";
import {
  DB_STATUSES,
  DISPLAY_STATUSES,
  HISTORY_STATUSES,
} from "@/lib/ticket-status";

/**
 * The parse boundary reads the vocabulary rather than restating it.
 *
 * This is the file that decides what the app ACCEPTS, so a list here that has
 * fallen behind `lib/ticket-status` does not read as a stale constant — it reads
 * as the ticket list going to its error state, because a legitimate row failed
 * to parse. All four enums were hand-written copies.
 */

/** What a ticket may be stored as, and therefore what a write may send. */
export const ticketStatusSchema = z.enum(DB_STATUSES);

/**
 * What a history row may say. Wider than the above: the table is append-only, so
 * rows from before the three-value model still carry `open`, `in_progress` and
 * `resolved`.
 */
export const ticketStatusRecordSchema = z.enum(HISTORY_STATUSES);

export const prioritySchema = z.enum(PRIORITIES);

/** What the reader sees. Four values — "In Progress" is derived server-side. */
export const displayStatusSchema = z.enum(DISPLAY_STATUSES);

export const ticketSchema = z.object({
  id: z.number(),
  subject: z.string(),
  description: z.string(),
  status: ticketStatusSchema,
  /**
   * The status to RENDER. Sent by the server alongside `status` so the two can
   * never be derived differently on each side; see DisplayStatus in lib/domain.
   */
  displayStatus: displayStatusSchema,
  priority: prioritySchema,
  requester: z.string(),
  requesterEmail: z.string(),
  /**
   * Who raised it, by id. What the closure buttons are keyed on — "is this mine"
   * is an identity question, and identity questions are answered on the id, not
   * on a display name or an email string.
   */
  requesterId: z.number(),
  /**
   * The requester's role. Read for one decision — `isInternalThread`, which
   * decides whether the thread has an external side to chat with and mail at all
   * — and deliberately not for permissions: what the VIEWER may do comes from
   * their own session, never from a field on the row.
   */
  requesterRole: roleSchema,
  assignee: z.string().nullable(),
  /** Filtering keys on this, not the display name — names are not unique. */
  assigneeId: z.number().nullable(),
  category: z.string(),
  /**
   * The SLA target and the actual finish time — the only SLA fields the client
   * takes. The server also sends `slaDue`/`slaState`, a pre-rendered snapshot
   * that clamps an overrun to "0h 0m" and collapses three different situations
   * into one `danger`; every surface now judges these two timestamps instead
   * (see ./sla), so the snapshot is deliberately left unparsed rather than kept
   * around for something to render again by accident.
   */
  dueAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
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

/**
 * `all` asks for the whole archive at once rather than one calendar window — the
 * mode the closed log reads in, because a log that only shows one month cannot be
 * searched without already knowing the month. The bucketed sizes remain for
 * anything that genuinely wants a single period.
 */
export const granularitySchema = z.enum(["all", "week", "month", "year"]);

/** The window sizes that resolve to an actual period — `all` has none. */
export const periodGranularitySchema = z.enum(["week", "month", "year"]);

/**
 * The window the server resolved, echoed back on every bucketed history response.
 * The client labels the period from `start`/`end` and navigates with the anchors —
 * it never computes calendar boundaries itself, so "this month" can't drift
 * between the two sides.
 */
export const periodSchema = z.object({
  granularity: periodGranularitySchema,
  start: z.string(),
  /** Exclusive: the first instant of the next period. */
  end: z.string(),
  prevAnchor: z.string(),
  nextAnchor: z.string(),
  /** The window contains now — the UI disables "newer" on it. */
  isCurrent: z.boolean(),
});

export const closedHistorySchema = z.object({
  data: z.array(ticketSchema),
  meta: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    returned: z.number(),
    /** Null when the whole archive was asked for: there is no window to label. */
    period: periodSchema.nullable(),
  }),
});

export type Granularity = z.infer<typeof granularitySchema>;
export type Period = z.infer<typeof periodSchema>;
export type ClosedHistoryPage = z.infer<typeof closedHistorySchema>;

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

/**
 * Why the server refused a row, as a code this app can translate.
 *
 * `.catch` rather than a strict enum: a server newer than this bundle may name a
 * reason we have no wording for, and a row that fails for an unfamiliar cause
 * should still read as failed rather than take the whole response down with a
 * parse error. `error` carries the server's own English sentence for that case.
 */
export const importErrorReasonSchema = z
  .enum(["unknown_category", "unknown_requester", "create_failed"])
  .catch("create_failed");

export const importRowResultSchema = z.discriminatedUnion("ok", [
  z.object({ index: z.number(), ok: z.literal(true), ticketId: z.number() }),
  z.object({
    index: z.number(),
    ok: z.literal(false),
    field: z.string().nullable(),
    // Absent from a server older than this bundle — treated as the generic case.
    reason: importErrorReasonSchema.default("create_failed"),
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
export type ImportErrorReason = z.infer<typeof importErrorReasonSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
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
