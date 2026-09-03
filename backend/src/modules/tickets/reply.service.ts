import type { AuthUser } from "../../shared/auth";
import { isInternalThread } from "../../shared/domain";
import { BadRequest } from "../../shared/errors";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { auditRepository } from "../audit/audit.repository";
import { commentService } from "../comments/comment.service";
import type { CommentDto } from "../comments/comment.repository";
import { ensureTicketRef } from "../integrations/email/email.parsers";
import { ticketService } from "./ticket.service";

export type ReplyInput = {
  to: string;
  subject?: string;
  body: string;
  attachments?: string[];
};

export type ReplyResult = {
  comment: CommentDto;
  /**
   * What was QUEUED, not what was delivered. The send happens on the outbox
   * sweep moments later, so this endpoint cannot report a transport or a
   * Message-ID any more — and reporting one would have been a guess.
   */
  mail: { queued: boolean; to: string; subject: string };
};

/**
 * Agent email reply. Records the message as a public comment — which is what
 * queues the mail: a public comment from staff IS the `comment.public_reply`
 * event, so this path adds an editable To: address and nothing else.
 *
 * It used to call the mail adapter directly, inside the request. That is now a
 * double send (the comment queues its own mail) and it broke the rule the outbox
 * exists to keep: a failing mail server must not fail an agent's reply, and
 * network I/O has no business on the request path. Going through the queue also
 * gets this path the things the direct send never had — HTML alongside the text
 * part, the recipient's own language, `In-Reply-To` threading, and retries.
 *
 * Attachments live on the ticket; their names are appended to the message body.
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

    // Reply-To on the queued mail is the help desk address, never the agent's own
    // mailbox — the requester hitting "Reply" has to come back through the
    // inbound webhook so the message lands on this ticket. Pointing it at the
    // agent would deliver the reply into their personal inbox instead, taking the
    // rest of the conversation, and the SLA clock with it, outside the ticket.
    if (env.smtp.host && !env.smtp.from) {
      logger.warn(
        { ticketId },
        "SMTP_FROM is unset: outbound mail falls back to the recipient's own address, so requester replies will bypass the ticket",
      );
    }

    const footer =
      input.attachments && input.attachments.length > 0
        ? `\n\n---\nAttachments: ${input.attachments.join(", ")}`
        : "";

    // Creating the comment is what queues the mail. The To: override rides along
    // so an agent who edited the address is honoured; everything else about the
    // message — subject, language, threading — is the mail layer's to decide, so
    // that a reply looks like every other mail this desk sends.
    const comment = await commentService.create(
      ticketId,
      {
        body: input.body + footer,
        internal: false,
        emailDeliverTo: input.to,
      },
      user,
    );

    // The subject the recipient will see, rebuilt here only to report it back.
    // `ensureTicketRef` is the same function the mail layer stamps with, so the
    // two cannot disagree about the tag that routes a reply home.
    const subject = ensureTicketRef(
      input.subject?.trim() || `Re: ${ticket.subject}`,
      ticketId,
    );

    await auditRepository.record({
      userId: user.id,
      action: "ticket.reply_email",
      entity: "ticket",
      entityId: ticketId,
      meta: { to: input.to, queued: true },
    });

    return { comment, mail: { queued: true, to: input.to, subject } };
  },
};
