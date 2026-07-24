import type { Request, Response } from "express";
import { Unauthorized } from "../../shared/errors";
import {
  bus,
  type CommentCreatedEvent,
  type TypingEvent,
} from "../../shared/events";
import { commentService } from "./comment.service";
import {
  commentIdParam,
  createCommentBody,
  ticketIdParam,
} from "./comment.validators";

function currentUser(req: Request) {
  if (!req.user) throw Unauthorized();
  return req.user;
}

export const commentController = {
  async list(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    const data = await commentService.list(ticketId, currentUser(req));
    res.json({ data });
  },

  async create(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    const input = createCommentBody.parse(req.body);
    const comment = await commentService.create(ticketId, input, currentUser(req));
    res.status(201).json({ data: comment });
  },

  /**
   * Server-Sent Events stream of new comments for one ticket. Push-based
   * replacement for client polling. The row scope is checked before the stream
   * opens; internal notes are only forwarded to write-capable subscribers.
   */
  async stream(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    const user = currentUser(req);
    const { canInternal } = await commentService.authorizeStream(ticketId, user);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // don't buffer behind nginx
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const onComment = ({ ticketId: tid, comment }: CommentCreatedEvent) => {
      if (tid !== ticketId) return;
      if (comment.internal && !canInternal) return;
      res.write(`event: comment.created\ndata: ${JSON.stringify(comment)}\n\n`);
    };
    bus.on("comment.created", onComment);

    // "X is typing" signals — forward to other subscribers on this ticket, never
    // back to the typist themselves.
    const onTyping = ({ ticketId: tid, userId, name }: TypingEvent) => {
      if (tid !== ticketId || userId === user.id) return;
      res.write(`event: typing\ndata: ${JSON.stringify({ userId, name })}\n\n`);
    };
    bus.on("typing", onTyping);

    // Heartbeat keeps the connection alive through idle-timeout proxies.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      bus.off("comment.created", onComment);
      bus.off("typing", onTyping);
    });
  },

  /**
   * Signal that the caller is typing in this ticket's chat. Fire-and-forget from
   * the client (throttled); scope-checked like the stream, then fanned out to the
   * ticket's other subscribers as a `typing` event. Holds no state server-side —
   * the indicator expires on the client after a short idle window.
   */
  async typing(req: Request, res: Response) {
    const { ticketId } = ticketIdParam.parse(req.params);
    const user = currentUser(req);
    await commentService.authorizeStream(ticketId, user); // row scope → 404 if out
    bus.emit("typing", { ticketId, userId: user.id, name: user.name });
    res.status(204).end();
  },

  async remove(req: Request, res: Response) {
    const { id } = commentIdParam.parse(req.params);
    await commentService.remove(id, currentUser(req));
    res.status(204).end();
  },
};
