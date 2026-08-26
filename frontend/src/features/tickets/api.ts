import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api-client";
import { tokenStore } from "@/features/auth/token-store";
import type { Priority, TicketStatus } from "@/lib/domain";
import {
  categoryListSchema,
  closedHistorySchema,
  commentEnvelopeSchema,
  commentListSchema,
  commentSchema,
  historyListSchema,
  importResultEnvelope,
  readListSchema,
  reassignEnvelopeSchema,
  replyResultEnvelope,
  ticketEnvelopeSchema,
  ticketListSchema,
  type Category,
  type ClosedHistoryPage,
  type Comment,
  type Granularity,
  type HistoryEntry,
  type ImportResult,
  type ReadMarker,
  type ReassignInput,
  type ReassignResult,
  type ReplyResult,
  type Ticket,
} from "./schemas";

export type TicketFilter = {
  status?: TicketStatus;
  priority?: Priority;
  /**
   * A user id narrows the list to that agent's queue; `"none"` is the unassigned
   * queue. Omit to not filter by assignee — which is NOT the same as `"none"`.
   */
  assigneeId?: number | "none";
};

export async function fetchTickets(
  filter: TicketFilter = {},
): Promise<{ tickets: Ticket[]; total: number }> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.priority) qs.set("priority", filter.priority);
  // `!= null` on purpose: 0 is not a valid id, but "none" must survive, and a
  // truthiness check would be a trap if ids ever start at 0.
  if (filter.assigneeId != null) qs.set("assigneeId", String(filter.assigneeId));
  const suffix = qs.toString() ? `?${qs}` : "";
  const body = await apiRequest(`/tickets${suffix}`);
  const parsed = ticketListSchema.parse(body);
  return { tickets: parsed.data, total: parsed.meta.total };
}

export type ClosedHistoryFilter = {
  /** `all` reads the whole archive; the bucketed sizes read one window. */
  granularity: Granularity;
  /**
   * Any instant inside the wanted period, as an ISO string. Ignored by the server
   * under `all`, which has no window to anchor.
   */
  anchor?: string;
  limit: number;
  offset: number;
  /** Narrow the results. Used to be a table column; it filters better than it reads. */
  priority?: Priority;
  /** Free text over subject, ticket id and requester name or email. */
  q?: string;
};

/** One page of the closed-ticket history log. */
export async function fetchClosedHistory(
  filter: ClosedHistoryFilter,
): Promise<ClosedHistoryPage> {
  const qs = new URLSearchParams();
  qs.set("granularity", filter.granularity);
  if (filter.anchor) qs.set("anchor", filter.anchor);
  qs.set("limit", String(filter.limit));
  qs.set("offset", String(filter.offset));
  if (filter.priority) qs.set("priority", filter.priority);
  if (filter.q) qs.set("q", filter.q);
  const body = await apiRequest(`/tickets/closed?${qs}`);
  return closedHistorySchema.parse(body);
}

/**
 * Hand one person's queue to another, or back to the unassigned queue with
 * `toUserId: null`. Server-side this is manager/admin only (`ticket:assign`) and
 * touches only tickets the caller can already see; it defaults to the statuses
 * still in flight, leaving resolved/closed history with its original assignee.
 */
export async function reassignTickets(
  input: ReassignInput,
): Promise<ReassignResult> {
  const body = await apiRequest("/tickets/reassign", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return reassignEnvelopeSchema.parse(body).data;
}

export async function fetchTicket(id: number): Promise<Ticket> {
  const body = await apiRequest(`/tickets/${id}`);
  return ticketEnvelopeSchema.parse(body).data;
}

/**
 * Soft-delete a ticket (super admin only; the API returns 403 for anyone else).
 * 204, so there is no body to parse.
 */
export async function deleteTicket(id: number): Promise<void> {
  await apiRequest(`/tickets/${id}`, { method: "DELETE" });
}

export async function updateTicketStatus(
  id: number,
  status: TicketStatus,
): Promise<Ticket> {
  const body = await apiRequest(`/tickets/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return ticketEnvelopeSchema.parse(body).data;
}

export async function updateTicketAssignee(
  id: number,
  assigneeId: number | null,
): Promise<Ticket> {
  const body = await apiRequest(`/tickets/${id}/assignee`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId }),
  });
  return ticketEnvelopeSchema.parse(body).data;
}

export async function updateTicketPriority(
  id: number,
  priority: Priority,
): Promise<Ticket> {
  const body = await apiRequest(`/tickets/${id}/priority`, {
    method: "PATCH",
    body: JSON.stringify({ priority }),
  });
  return ticketEnvelopeSchema.parse(body).data;
}

export async function fetchCategories(): Promise<Category[]> {
  const body = await apiRequest("/categories");
  return categoryListSchema.parse(body).data;
}

export type CreateTicketInput = {
  subject: string;
  description: string;
  categoryId: number;
  priority: Priority;
  /**
   * De-duplication key for this submission. Optional so other callers need not
   * mint one; the create dialog always does, because it is the surface where a
   * retry after a failed submit is a normal thing to do.
   */
  idempotencyKey?: string;
};

/**
 * Raise a ticket.
 *
 * `idempotencyKey` rides as a header rather than in the body: it is about the
 * request, not the ticket, and the server never stores it as ticket content.
 * Sending the same key again returns the ticket the first attempt created, so a
 * retry after a lost response cannot leave two.
 */
export async function createTicket({
  idempotencyKey,
  ...input
}: CreateTicketInput): Promise<Ticket> {
  const body = await apiRequest("/tickets", {
    method: "POST",
    body: JSON.stringify(input),
    ...(idempotencyKey
      ? { headers: { "Idempotency-Key": idempotencyKey } }
      : {}),
  });
  return ticketEnvelopeSchema.parse(body).data;
}

export type ImportTicketRow = {
  subject: string;
  description: string;
  priority: Priority;
  category: string;
  requesterEmail: string;
};

export async function importTickets(
  rows: ImportTicketRow[],
): Promise<ImportResult> {
  const body = await apiRequest("/tickets/import", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  return importResultEnvelope.parse(body).data;
}

export type SendReplyInput = {
  to: string;
  subject?: string;
  body: string;
  attachments?: string[];
};

/** Send an agent email reply — dispatches mail AND records a public comment. */
export async function sendReply(
  ticketId: number,
  input: SendReplyInput,
): Promise<ReplyResult> {
  const body = await apiRequest(`/tickets/${ticketId}/reply`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return replyResultEnvelope.parse(body).data;
}

export async function fetchComments(ticketId: number): Promise<Comment[]> {
  const body = await apiRequest(`/tickets/${ticketId}/comments`);
  return commentListSchema.parse(body).data;
}

/**
 * Subscribe to a ticket's comment stream over SSE. Uses fetch (not EventSource)
 * so the in-memory bearer token can be sent as a header. Resolves when the
 * stream ends (server close / abort); throws on a failed connection so the
 * caller can reconnect. `onComment` fires for each new comment pushed.
 */
/** Best-effort "I'm typing" ping for the chat (throttled by the caller). */
export async function sendTyping(ticketId: number): Promise<void> {
  try {
    await apiRequest(`/tickets/${ticketId}/comments/typing`, { method: "POST" });
  } catch {
    /* typing signals are non-critical — ignore failures */
  }
}

/** Record how far the caller has read the chat (best-effort read receipt). */
export async function markRead(
  ticketId: number,
  lastReadId: number,
): Promise<void> {
  try {
    await apiRequest(`/tickets/${ticketId}/comments/read`, {
      method: "POST",
      body: JSON.stringify({ lastReadId }),
    });
  } catch {
    /* read receipts are non-critical — ignore failures */
  }
}

/** Every participant's read pointer for a ticket. */
export async function fetchReads(ticketId: number): Promise<ReadMarker[]> {
  const body = await apiRequest(`/tickets/${ticketId}/comments/reads`);
  return readListSchema.parse(body).data;
}

export type TypingSignal = { userId: number; name: string };
export type ReadSignal = { userId: number; name: string; lastReadId: number };

export async function streamComments(
  ticketId: number,
  signal: AbortSignal,
  onComment: (comment: Comment) => void,
  onTyping?: (signal: TypingSignal) => void,
  onRead?: (signal: ReadSignal) => void,
): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(
    `${API_BASE_URL}/tickets/${ticketId}/comments/stream`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, "STREAM_ERROR", "Comment stream failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trimStart();
      }
      if (event === "comment.created" && data) {
        try {
          onComment(commentSchema.parse(JSON.parse(data)));
        } catch {
          /* ignore a malformed frame */
        }
      } else if (event === "typing" && data && onTyping) {
        try {
          const t = JSON.parse(data) as TypingSignal;
          if (typeof t.userId === "number" && typeof t.name === "string") {
            onTyping(t);
          }
        } catch {
          /* ignore a malformed frame */
        }
      } else if (event === "read" && data && onRead) {
        try {
          const r = JSON.parse(data) as ReadSignal;
          if (typeof r.userId === "number" && typeof r.lastReadId === "number") {
            onRead(r);
          }
        } catch {
          /* ignore a malformed frame */
        }
      }
    }
  }
}

export async function fetchTicketHistory(
  ticketId: number,
): Promise<HistoryEntry[]> {
  const body = await apiRequest(`/tickets/${ticketId}/history`);
  return historyListSchema.parse(body).data;
}

export type CreateCommentInput = { body: string; internal: boolean };

export async function createComment(
  ticketId: number,
  input: CreateCommentInput,
): Promise<Comment> {
  const body = await apiRequest(`/tickets/${ticketId}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return commentEnvelopeSchema.parse(body).data;
}
