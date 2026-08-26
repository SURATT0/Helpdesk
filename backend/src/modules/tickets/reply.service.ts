import type { AuthUser } from "../../shared/auth";
import { isInternalThread } from "../../shared/domain";
import { BadRequest } from "../../shared/errors";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { auditRepository } from "../audit/audit.repository";
import { commentService } from "../comments/comment.service";
import {
  commentRepository,
  type CommentDto,
} from "../comments/comment.repository";
import { ensureTicketRef } from "../integrations/email/email.parsers";
import { mailSender } from "../integrations/email/mail-sender";
import { ticketService } from "./ticket.service";

export type ReplyInput = {
  to: string;
  subject?: string;
  body: string;
  attachments?: string[];
};

export type ReplyResult = {
  comment: CommentDto;
  mail: { transport: string; to: string; subject: string; messageId?: string };
};

/**
 * Agent email reply. Records the message as a public comment (so it appears in
 * the ticket thread and follows the same row-scope authorization) AND dispatches
 * an email to the requester via the outbound mail adapter (real SMTP when
 * configured, a logging transport otherwise). Attachments live on the ticket;
 * their names are appended to the email body.
 */
export const replyService = {
  async send(
    ticketId: number,
    input: ReplyInput,
    user: AuthUser,
  ): Promise<ReplyResult> {
    // ticketService.get enforces row scope (404 if out of scope).
    const ticket = await ticketService.get(ticketId, user);

    // Nobody to write to. A ticket raised by staff is worked as an internal
    // thread (see isInternalThread), so this would mail the desk its own message
    // — and, worse, invite a reply that the inbound webhook would thread back
    // onto the ticket as if a requester had answered. Refused rather than
    // silently downgraded to a note: sending mail is what the caller asked for,
    // and quietly not sending it is the failure mode an agent would not notice.
    if (isInternalThread(ticket.requesterRole)) {
      throw BadRequest(
        `Ticket #${ticketId} was raised by the desk itself, so there is no requester to email — add an internal note instead`,
      );
    }

    const comment = await commentService.create(
      ticketId,
      { body: input.body, internal: false },
      user,
    );

    // The `[#id]` tag is what routes the reply back onto this ticket, so it is
    // stamped unconditionally — including onto a caller-supplied subject, which
    // would otherwise go out without one and make its reply unthreadable.
    const subject = ensureTicketRef(
      input.subject?.trim() || `Re: ${ticket.subject}`,
      ticketId,
    );
    const footer =
      input.attachments && input.attachments.length > 0
        ? `\n\n---\nAttachments: ${input.attachments.join(", ")}`
        : "";
    // Reply-To is the help desk address, never the agent's own mailbox. The
    // requester hitting "Reply" must come back through the inbound webhook so the
    // message lands on this ticket (the `[#id]` tag in the subject is what routes
    // it); pointing Reply-To at the agent would deliver the reply into their
    // personal inbox instead, taking the rest of the conversation — and the SLA
    // clock with it — outside the ticket entirely.
    if (env.smtp.host && !env.smtp.from) {
      logger.warn(
        { ticketId },
        "SMTP_FROM is unset: outbound replies fall back to the agent's own address, so requester replies will bypass the ticket",
      );
    }
    const sent = await mailSender.send({
      from: env.smtp.from || user.email,
      to: input.to,
      subject,
      text: input.body + footer,
      replyTo: env.smtp.from,
    });

    // Remember which mail this comment was sent as. Recorded after dispatch
    // because the transport mints the id; it lets a header-based (In-Reply-To)
    // threading upgrade match a reply back to this exact message later.
    if (sent.messageId) {
      await commentRepository.setMessageId(comment.id, sent.messageId);
    }

    await auditRepository.record({
      userId: user.id,
      action: "ticket.reply_email",
      entity: "ticket",
      entityId: ticketId,
      meta: { to: input.to, transport: sent.transport },
    });

    return {
      comment,
      mail: {
        transport: sent.transport,
        to: input.to,
        subject,
        messageId: sent.messageId,
      },
    };
  },
};
