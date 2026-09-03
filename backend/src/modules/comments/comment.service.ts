import { Forbidden, NotFound } from "../../shared/errors";
import { hasPermission, type AuthUser } from "../../shared/auth";
import { isInternalThread } from "../../shared/domain";
import { bus } from "../../shared/events";
import { ticketService } from "../tickets/ticket.service";
import {
  commentRepository,
  type CommentDto,
  type ReadMarker,
} from "./comment.repository";

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
    input: {
      body: string;
      internal: boolean;
      /**
       * Where the requester's mail for this message should go, when the caller
       * has a reason to override it. Only the agent reply composer does, via its
       * editable To: field — see `commentRepository.create`.
       */
      emailDeliverTo?: string;
    },
    user: AuthUser,
  ): Promise<CommentDto> {
    const ticket = await ticketService.get(ticketId, user); // must see the ticket
    if (input.internal && !hasPermission(user, "ticket:write")) {
      throw Forbidden("Only agents can add internal notes");
    }
    // A ticket raised by staff has no external side (see isInternalThread), so a
    // public comment on one has no audience a note doesn't already reach: the row
    // scope shows it to the desk either way. Stored as a note rather than refused
    // because refusing would only strand a client that still has the old composer
    // open, and the message it is trying to send is a note by every other measure.
    // The permission check above stays keyed on what the CLIENT asked for — a
    // caller who may not write notes is not made to fail here by our own coercion.
    const internal =
      input.internal || isInternalThread(ticket.requesterRole);
    const comment = await commentRepository.create({
      ticketId,
      authorId: user.id,
      body: input.body,
      internal,
      // A note has no requester copy to redirect, so the override is dropped
      // rather than carried into a path that would ignore it anyway.
      ...(internal ? {} : { emailDeliverTo: input.emailDeliverTo }),
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

  /**
   * Record that a user has read a ticket's chat up to `commentId` (pointer only
   * advances). Scope-checked, then fanned out as a `read` event so the other
   * participants' clients can flip their sent messages to "read".
   */
  async markRead(
    ticketId: number,
    commentId: number,
    user: AuthUser,
  ): Promise<number> {
    await ticketService.get(ticketId, user); // row scope → 404 if out of scope
    const lastReadId = await commentRepository.markRead(
      ticketId,
      user.id,
      commentId,
    );
    bus.emit("read", { ticketId, userId: user.id, name: user.name, lastReadId });
    return lastReadId;
  },

  /** Every participant's read pointer for a ticket (scope-checked). */
  async reads(ticketId: number, user: AuthUser): Promise<ReadMarker[]> {
    await ticketService.get(ticketId, user);
    return commentRepository.findReads(ticketId);
  },

  async remove(id: number, user: AuthUser): Promise<void> {
    const comment = await commentRepository.findById(id);
    if (!comment || comment.deletedAt) throw NotFound("Comment not found");

    const isOwner = comment.authorId === user.id;
    // Deleting someone else's comment is moderation, so it stays at the top tier —
    // the same line as before, when it was manager-or-admin. An admin working the
    // case can still delete their own.
    const mayModerate = user.role === "super_admin";
    if (!isOwner && !mayModerate) throw Forbidden("Cannot delete this comment");

    await ticketService.get(comment.ticketId, user); // ticket must be in scope
    await commentRepository.softDelete(id, user.id);
  },
};
