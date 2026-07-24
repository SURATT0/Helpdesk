import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Priority, TicketStatus } from "@/lib/domain";
import { useAuth } from "@/features/auth/context";
import type { Comment } from "./schemas";
import {
  createComment,
  createTicket,
  fetchCategories,
  fetchComments,
  fetchReads,
  fetchTicket,
  fetchTicketHistory,
  fetchTickets,
  importTickets,
  sendReply,
  streamComments,
  updateTicketAssignee,
  updateTicketPriority,
  updateTicketStatus,
  type CreateCommentInput,
  type CreateTicketInput,
  type ImportTicketRow,
  type SendReplyInput,
  type TicketFilter,
} from "./api";

export const ticketKeys = {
  all: ["tickets"] as const,
  list: (filter: TicketFilter) => ["tickets", "list", filter] as const,
  detail: (id: number) => ["tickets", "detail", id] as const,
  history: (id: number) => ["tickets", "history", id] as const,
};

export function useTickets(filter: TicketFilter = {}) {
  return useQuery({
    queryKey: ticketKeys.list(filter),
    queryFn: () => fetchTickets(filter),
  });
}

export function useTicket(id: number) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: () => fetchTicket(id),
    enabled: Number.isFinite(id),
  });
}

export function useTicketHistory(id: number) {
  return useQuery({
    queryKey: ticketKeys.history(id),
    queryFn: () => fetchTicketHistory(id),
    enabled: Number.isFinite(id),
  });
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; status: TicketStatus }) =>
      updateTicketStatus(vars.id, vars.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}

export type BulkAction =
  | { kind: "status"; status: TicketStatus }
  | { kind: "assignee"; assigneeId: number | null }
  | { kind: "priority"; priority: Priority };

/**
 * Apply one action across many tickets. Each ticket is patched independently
 * (fan-out) so a per-ticket failure — e.g. an illegal status transition — is
 * counted, not fatal. Returns how many of the batch failed.
 */
export function useBulkTicketAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { ids: number[]; action: BulkAction }) => {
      const run = (id: number) => {
        switch (vars.action.kind) {
          case "status":
            return updateTicketStatus(id, vars.action.status);
          case "assignee":
            return updateTicketAssignee(id, vars.action.assigneeId);
          case "priority":
            return updateTicketPriority(id, vars.action.priority);
        }
      };
      const results = await Promise.allSettled(vars.ids.map(run));
      return {
        total: vars.ids.length,
        failed: results.filter((r) => r.status === "rejected").length,
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}

export const categoryKeys = { all: ["categories"] as const };

export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.all,
    queryFn: fetchCategories,
    staleTime: 5 * 60_000,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => createTicket(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}

export function useImportTickets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: ImportTicketRow[]) => importTickets(rows),
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}

export const commentKeys = {
  list: (ticketId: number) => ["comments", ticketId] as const,
};

export function useComments(ticketId: number) {
  return useQuery({
    queryKey: commentKeys.list(ticketId),
    queryFn: () => fetchComments(ticketId),
    enabled: Number.isFinite(ticketId),
    // Live updates come from the SSE stream (useCommentStream), not polling.
    // A focus refetch catches anything missed while the tab was backgrounded.
    refetchOnWindowFocus: true,
  });
}

/**
 * Subscribe to the ticket's SSE comment stream and merge pushed messages into
 * the comments cache (deduped by id, so the sender's own echo is a no-op). Auto-
 * reconnects with a short backoff if the connection drops.
 */
/** How long a "typing" signal stays live on the client before it auto-clears. */
const TYPING_TTL_MS = 4000;

export function useCommentStream(ticketId: number) {
  const qc = useQueryClient();
  // userId → { name, at }: other participants currently typing. Each signal is
  // refreshed by the sender's throttled pings and expires TYPING_TTL after the
  // last one, so the indicator clears shortly after they stop.
  const [typing, setTyping] = React.useState<
    Record<number, { name: string; at: number }>
  >({});
  // userId → last comment id that user has read (read receipts).
  const [reads, setReads] = React.useState<Record<number, number>>({});

  // Seed read pointers on open; live updates arrive via the stream below.
  React.useEffect(() => {
    if (!Number.isFinite(ticketId)) return;
    let active = true;
    fetchReads(ticketId)
      .then((markers) => {
        if (!active) return;
        setReads(
          Object.fromEntries(markers.map((m) => [m.userId, m.lastReadCommentId])),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ticketId]);

  React.useEffect(() => {
    const iv = setInterval(() => {
      setTyping((cur) => {
        const now = Date.now();
        const next: typeof cur = {};
        let changed = false;
        for (const [id, v] of Object.entries(cur)) {
          if (now - v.at < TYPING_TTL_MS) next[Number(id)] = v;
          else changed = true;
        }
        return changed ? next : cur;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  React.useEffect(() => {
    if (!Number.isFinite(ticketId)) return;
    let stopped = false;
    const controller = new AbortController();
    (async () => {
      while (!stopped) {
        try {
          await streamComments(
            ticketId,
            controller.signal,
            (comment) => {
              qc.setQueryData<Comment[]>(commentKeys.list(ticketId), (old) => {
                const list = old ?? [];
                return list.some((c) => c.id === comment.id)
                  ? list
                  : [...list, comment];
              });
              // Their message landed → they're no longer typing.
              setTyping((cur) => {
                if (!(comment.author.id in cur)) return cur;
                const next = { ...cur };
                delete next[comment.author.id];
                return next;
              });
            },
            (t) =>
              setTyping((cur) => ({
                ...cur,
                [t.userId]: { name: t.name, at: Date.now() },
              })),
            (r) =>
              setReads((cur) => ({
                ...cur,
                [r.userId]: Math.max(cur[r.userId] ?? 0, r.lastReadId),
              })),
          );
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 2000)); // backoff, then reconnect
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [ticketId, qc]);

  const typingNames = React.useMemo(
    () => Object.values(typing).map((v) => v.name),
    [typing],
  );
  return { typingNames, reads };
}

/**
 * Post a comment with an optimistic thread entry: the message shows immediately
 * with a "sending" status, is swapped for the server's copy on success (deduped
 * against the SSE echo of our own message), or flipped to "failed" so the caller
 * can offer a retry. `clientId` keys the optimistic entry across those states.
 */
export function useCreateComment(ticketId: number) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => createComment(ticketId, input),
    onMutate: async (input): Promise<{ clientId: string }> => {
      const clientId = `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      await qc.cancelQueries({ queryKey: commentKeys.list(ticketId) });
      if (user) {
        const optimistic: Comment = {
          id: -Date.now(), // temporary; never collides with server ids (positive)
          body: input.body,
          internal: input.internal,
          createdAt: new Date().toISOString(),
          author: { id: user.id, name: user.name, role: user.role },
          clientId,
          sendStatus: "sending",
        };
        qc.setQueryData<Comment[]>(commentKeys.list(ticketId), (old) => [
          ...(old ?? []),
          optimistic,
        ]);
      }
      return { clientId };
    },
    onSuccess: (real, _input, ctx) => {
      // Replace the optimistic entry with the server comment. The SSE stream also
      // echoes our own message back, so dedupe by id to avoid a double.
      qc.setQueryData<Comment[]>(commentKeys.list(ticketId), (old) => {
        const rest = (old ?? []).filter((c) => c.clientId !== ctx?.clientId);
        return rest.some((c) => c.id === real.id) ? rest : [...rest, real];
      });
    },
    onError: (_err, _input, ctx) => {
      // Keep the message in the thread but mark it failed → the UI shows a retry.
      qc.setQueryData<Comment[]>(commentKeys.list(ticketId), (old) =>
        (old ?? []).map((c) =>
          c.clientId === ctx?.clientId ? { ...c, sendStatus: "failed" } : c,
        ),
      );
    },
  });
}

/** Drop a failed optimistic message from the thread (used before a retry). */
export function useRemoveFailedComment(ticketId: number) {
  const qc = useQueryClient();
  return (clientId: string) =>
    qc.setQueryData<Comment[]>(commentKeys.list(ticketId), (old) =>
      (old ?? []).filter((c) => c.clientId !== clientId),
    );
}

export function useSendReply(ticketId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendReplyInput) => sendReply(ticketId, input),
    // The reply is recorded as a comment — refresh the thread.
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: commentKeys.list(ticketId) }),
  });
}
