import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config/env";
import { logger } from "../../../shared/logger";

export type OutboundMail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  /**
   * The HTML alternative. When present the message goes out as multipart —
   * `text` is not replaced by it, it is the fallback every text-only client and
   * several spam filters expect to find.
   */
  html?: string;
  /** Optional CC / reply-to (reply-to points back at the agent). */
  replyTo?: string;
  /**
   * RFC 5322 threading. `inReplyTo` names the message being answered and
   * `references` the chain leading to it; a client groups a conversation from
   * these, not from the subject line. Both must be full angle-bracketed
   * Message-IDs.
   */
  inReplyTo?: string;
  references?: string[];
  /**
   * Extra headers, for `X-Deskly-Ticket-Id`. That one exists so inbound mail can
   * be matched on a header instead of only on a subject tag a person can edit,
   * delete, or lose when their client rewrites the subject.
   */
  headers?: Record<string, string>;
};

export type SendResult = { transport: string; messageId?: string };

/**
 * Outbound mail adapter. Mirrors the IFileStorage pattern: one interface, a real
 * SMTP driver (nodemailer) chosen when SMTP_HOST is set, and a "log" fallback so
 * agent replies work end-to-end in dev without a mail server.
 */
export interface IMailSender {
  readonly transport: string;
  send(mail: OutboundMail): Promise<SendResult>;
}

/** Records the message to the logs instead of sending — dev default. */
class LogMailSender implements IMailSender {
  readonly transport = "log";
  async send(mail: OutboundMail): Promise<SendResult> {
    logger.info(
      {
        to: mail.to,
        from: mail.from,
        subject: mail.subject,
        inReplyTo: mail.inReplyTo,
        multipart: Boolean(mail.html),
      },
      "outbound email (log transport — SMTP not configured)",
    );
    // Mint an id rather than returning none. A real transport stamps one, and
    // the threading chain is built from what the PREVIOUS send returned — with
    // no id here the second mail on a ticket would have nothing to reference and
    // dev would silently exercise a different code path from production.
    return {
      transport: this.transport,
      messageId: `<${randomUUID()}@deskly.local>`,
    };
  }
}

class SmtpMailSender implements IMailSender {
  readonly transport = "smtp";
  private readonly tx: Transporter;
  constructor() {
    this.tx = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth:
        env.smtp.user && env.smtp.password
          ? { user: env.smtp.user, pass: env.smtp.password }
          : undefined,
    });
  }
  async send(mail: OutboundMail): Promise<SendResult> {
    const info = await this.tx.sendMail({
      from: env.smtp.from || mail.from,
      to: mail.to,
      subject: mail.subject,
      // Passing both is what makes nodemailer build a multipart/alternative
      // body. Sending `html` alone would leave a text client with nothing.
      text: mail.text,
      html: mail.html,
      replyTo: mail.replyTo,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      headers: mail.headers,
    });
    return { transport: this.transport, messageId: info.messageId };
  }
}

export const mailSender: IMailSender = env.smtp.host
  ? new SmtpMailSender()
  : new LogMailSender();
