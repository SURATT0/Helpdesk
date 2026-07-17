import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config/env";
import { logger } from "../../../shared/logger";

export type OutboundMail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Optional CC / reply-to (reply-to points back at the agent). */
  replyTo?: string;
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
      { to: mail.to, from: mail.from, subject: mail.subject },
      "outbound email (log transport — SMTP not configured)",
    );
    return { transport: this.transport };
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
      text: mail.text,
      replyTo: mail.replyTo,
    });
    return { transport: this.transport, messageId: info.messageId };
  }
}

export const mailSender: IMailSender = env.smtp.host
  ? new SmtpMailSender()
  : new LogMailSender();
