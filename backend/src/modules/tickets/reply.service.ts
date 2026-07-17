import type { AuthUser } from "../../shared/auth";
import { auditRepository } from "../audit/audit.repository";
import { commentService } from "../comments/comment.service";
import type { CommentDto } from "../comments/comment.repository";
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

    const comment = await commentService.create(
      ticketId,
      { body: input.body, internal: false },
      user,
    );

    const subject =
      input.subject?.trim() || `Re: [#${ticketId}] ${ticket.subject}`;
    const footer =
      input.attachments && input.attachments.length > 0
        ? `\n\n---\nAttachments: ${input.attachments.join(", ")}`
        : "";
    const sent = await mailSender.send({
      from: user.email,
      to: input.to,
      subject,
      text: input.body + footer,
      replyTo: user.email,
    });

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
