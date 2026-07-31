import { env } from "../../config/env";
import type { AuthUser } from "../../shared/auth";
import { logger } from "../../shared/logger";
import { auditRepository } from "../audit/audit.repository";
import { commentService } from "../comments/comment.service";
import { commentRepository } from "../comments/comment.repository";
import type { CommentDto } from "../comments/comment.repository";
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
 * The address requester replies must come back to: the shared helpdesk inbox
 * that feeds the inbound webhook / IMAP poller.
 *
 * Returns undefined rather than falling back to the agent's own address when
 * nothing is configured. That fallback is exactly the leak this guards: it would
 * route the requester's reply into an agent's personal mailbox, taking the rest
 * of the conversation outside the ticket and outside the audit trail. No Reply-To
 * is a visibly broken loop; a personal Reply-To is an invisibly broken one.
 * `validateEnv` warns at boot when this is unset with SMTP configured.
 */
function systemReplyAddress(): string | undefined {
  return env.smtp.replyTo || env.smtp.from || undefined;
}

/**
 * Agent email reply. Records the message as a public comment (so it appears in
 * the ticket thread and follows the same row-scope authorization) AND dispatches
 * an email to the requester via the outbound mail adapter (real SMTP when
 * configured, a logging transport otherwise). Attachments live on the ticket;
 * their names are appended to the email body.
 *
 * The comment is written BEFORE the mail goes out, deliberately: the ticket is
 * the record of the conversation, so it must exist even if delivery fails.
 */
export const replyService = {
  async send(
    ticketId: number,
    input: ReplyInput,
    user: AuthUser,
  ): Promise<ReplyResult> {
    // ticketService.get enforces row scope (404 if out of scope).
    const ticket = await ticketService.get(ticketId, user);

    const comment = await commentService.create(
      ticketId,
      { body: input.body, internal: false },
      user,
    );

    // The ticket ref is what lets a reply find its way home when the provider
    // drops In-Reply-To. Stamped on a caller-supplied subject too, so a custom
    // subject can't quietly break threading.
    const subject = ensureTicketRef(
      input.subject?.trim() || `Re: ${ticket.subject}`,
      ticketId,
    );
    const footer =
      input.attachments && input.attachments.length > 0
        ? `\n\n---\nAttachments: ${input.attachments.join(", ")}`
        : "";
    const replyTo = systemReplyAddress();
    const sent = await mailSender.send({
      // Both From and Reply-To are the helpdesk identity, never the agent's
      // personal address — see systemReplyAddress above.
      from: replyTo ?? user.email,
      to: input.to,
      subject,
      text: input.body + footer,
      replyTo,
    });

    // Remember the outbound Message-ID so the requester's reply threads back by
    // header rather than relying on the subject tag surviving their mail client.
    if (sent.messageId) {
      await commentRepository
        .attachMessageId(comment.id, sent.messageId)
        .catch((err: unknown) => {
          logger.warn(
            { err, commentId: comment.id, ticketId },
            "could not store outbound Message-ID; replies will thread by subject ref only",
          );
        });
    }

    await auditRepository.record({
      userId: user.id,
      action: "ticket.reply_email",
      entity: "ticket",
      entityId: ticketId,
      meta: {
        to: input.to,
        transport: sent.transport,
        replyTo: replyTo ?? null,
      },
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
