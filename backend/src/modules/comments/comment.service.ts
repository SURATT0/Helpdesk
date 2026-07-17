import { Forbidden, NotFound } from "../../shared/errors";
import { hasPermission, type AuthUser } from "../../shared/auth";
import { bus } from "../../shared/events";
import { ticketService } from "../tickets/ticket.service";
import { commentRepository, type CommentDto } from "./comment.repository";

/**
 * Comment rules. Access to a ticket's comments follows the ticket's row scope
 * (delegated to ticketService.get, which 404s out-of-scope). Internal notes are
 * visible to — and creatable by — write-capable roles only.
 */
export const commentService = {
  async list(ticketId: number, user: AuthUser): Promise<CommentDto[]> {
    await ticketService.get(ticketId, user); // authorize via ticket scope
    return commentRepository.findByTicket(
      ticketId,
      hasPermission(user, "ticket:write"),
    );
  },

  async create(
    ticketId: number,
    input: { body: string; internal: boolean },
    user: AuthUser,
  ): Promise<CommentDto> {
    await ticketService.get(ticketId, user); // must be able to see the ticket
    if (input.internal && !hasPermission(user, "ticket:write")) {
      throw Forbidden("Only agents can add internal notes");
    }
    const comment = await commentRepository.create({
      ticketId,
      authorId: user.id,
      body: input.body,
      internal: input.internal,
    });
    // Real-time fan-out to SSE subscribers on this ticket.
    bus.emit("comment.created", { ticketId, comment });
    return comment;
  },

  /**
   * Authorize a real-time subscription to a ticket's comments. Applies the same
   * row scope as reads (404 if out of scope) and reports whether the subscriber
   * may receive internal notes.
   */
  async authorizeStream(
    ticketId: number,
    user: AuthUser,
  ): Promise<{ canInternal: boolean }> {
    await ticketService.get(ticketId, user);
    return { canInternal: hasPermission(user, "ticket:write") };
  },

  async remove(id: number, user: AuthUser): Promise<void> {
    const comment = await commentRepository.findById(id);
    if (!comment || comment.deletedAt) throw NotFound("Comment not found");

    const isOwner = comment.authorId === user.id;
    const isManager = user.role === "admin" || user.role === "manager";
    if (!isOwner && !isManager) throw Forbidden("Cannot delete this comment");

    await ticketService.get(comment.ticketId, user); // ticket must be in scope
    await commentRepository.softDelete(id, user.id);
  },
};
