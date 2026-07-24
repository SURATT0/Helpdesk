import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api-client";
import { tokenStore } from "@/features/auth/token-store";
import type { Priority, TicketStatus } from "@/lib/domain";
import {
  categoryListSchema,
  commentEnvelopeSchema,
  commentListSchema,
  commentSchema,
  historyListSchema,
  importResultEnvelope,
  readListSchema,
  replyResultEnvelope,
  ticketEnvelopeSchema,
  ticketListSchema,
  type Category,
  type Comment,
  type HistoryEntry,
  type ImportResult,
  type ReadMarker,
  type ReplyResult,
  type Ticket,
} from "./schemas";

export type TicketFilter = {
  status?: TicketStatus;
  priority?: Priority;
};

export async function fetchTickets(
  filter: TicketFilter = {},
): Promise<{ tickets: Ticket[]; total: number }> {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.priority) qs.set("priority", filter.priority);
  const suffix = qs.toString() ? `?${qs}` : "";
  const body = await apiRequest(`/tickets${suffix}`);
  const parsed = ticketListSchema.parse(body);
  return { tickets: parsed.data, total: parsed.meta.total };
}

export async function fetchTicket(id: number): Promise<Ticket> {
  const body = await apiRequest(`/tickets/${id}`);
  return ticketEnvelopeSchema.parse(body).data;
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
};

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const body = await apiRequest("/tickets", {
    method: "POST",
    body: JSON.stringify(input),
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
