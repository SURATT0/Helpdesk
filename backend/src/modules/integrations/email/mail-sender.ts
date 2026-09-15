import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../../config/env";
import { logger } from "../../../shared/logger";
import { graphConfigured, graphFetch, safeText } from "./graph-client";

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
      // Fail fast when the server is not there. nodemailer's defaults are
      // minutes long, and the sweep sends sequentially — so one unreachable host
      // turns a batch of 100 into hours of hanging sockets, with a fresh sweep
      // starting every 60s on top of it. That is not a mail problem by then, it
      // is a connection-pool problem, and the API starts timing out with it.
      //
      // A send that fails in seconds is exactly what the retry/backoff is for.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
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

/**
 * Sends as the 365 mailbox, through the Graph API.
 *
 * Two calls, not one. `POST /sendMail` sends in a single request and returns
 * 202 with no body — no Message-ID — and the threading chain here is built from
 * what the PREVIOUS send returned. So this creates a draft, reads the
 * `internetMessageId` Exchange stamped on it, then sends that draft. The extra
 * round trip buys a real id, and without it every mail in a conversation would
 * reference nothing.
 *
 * The From is the mailbox in the URL, not `SMTP_FROM`: an app-only token sends
 * as whichever mailbox it names, and Exchange will not let it claim another
 * address. `GRAPH_MAILBOX` is therefore both where mail is read and where it is
 * sent from, which is what a support address usually is.
 *
 * Needs `Mail.Send` on the app registration, which is a SEPARATE permission
 * from the `Mail.ReadWrite` the inbox reader uses. Granting one does not grant
 * the other; a 403 here with `Mail.Send` in the body is what that looks like.
 */
class GraphMailSender implements IMailSender {
  readonly transport = "graph";

  async send(mail: OutboundMail): Promise<SendResult> {
    const { mailbox } = env.integrations.graph;
    const box = encodeURIComponent(mailbox!);

    const draft = await graphFetch(`/users/${box}/messages`, {
      method: "POST",
      body: JSON.stringify({
        subject: mail.subject,
        // HTML when there is any, because Graph carries one body rather than
        // the multipart alternative SMTP builds. The plain text is what every
        // client can already render from HTML; the reverse is not true.
        body: mail.html
          ? { contentType: "HTML", content: mail.html }
          : { contentType: "Text", content: mail.text },
        toRecipients: [{ emailAddress: { address: mail.to } }],
        ...(mail.replyTo
          ? { replyTo: [{ emailAddress: { address: mail.replyTo } }] }
          : {}),
        // Only `X-` headers are allowed here by Graph, which is exactly what
        // `X-Deskly-Ticket-Id` is. `In-Reply-To` and `References` cannot be set
        // this way — they need extended MAPI properties — so a reply threads on
        // the subject tag and this header instead, which is the pair inbound
        // already matches on. See InboundEmail.ticketIdHeader.
        ...(mail.headers
          ? {
              internetMessageHeaders: Object.entries(mail.headers)
                .filter(([name]) => name.toLowerCase().startsWith("x-"))
                .map(([name, value]) => ({ name, value })),
            }
          : {}),
      }),
    });
    if (!draft.ok) {
      throw new Error(
        `Graph draft failed (${draft.status}): ${await safeText(draft)}`,
      );
    }
    const created = (await draft.json()) as {
      id: string;
      internetMessageId?: string;
    };

    const sent = await graphFetch(`/users/${box}/messages/${created.id}/send`, {
      method: "POST",
    });
    if (!sent.ok) {
      throw new Error(
        `Graph send failed (${sent.status}): ${await safeText(sent)}`,
      );
    }
    return { transport: this.transport, messageId: created.internetMessageId };
  }
}

/**
 * Which way mail goes out, most explicit first.
 *
 * SMTP wins when a host is named: someone who set one meant it, and it is the
 * only option that can send as an address the Graph app does not own. Graph is
 * next, because a fully configured 365 mailbox is a real mailbox and preferring
 * the log transport over it would silently throw mail away. The log transport
 * is last and is a dev fallback, not a choice.
 *
 * `GRAPH_SEND=false` opts out — for a deployment that reads 365 mail but sends
 * through something else, where picking Graph would send from the wrong address.
 */
export const mailSender: IMailSender = env.smtp.host
  ? new SmtpMailSender()
  : graphConfigured() && env.integrations.graph.send
    ? new GraphMailSender()
    : new LogMailSender();
