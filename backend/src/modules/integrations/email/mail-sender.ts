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
 * A Graph `message` resource, shared by both ways of sending it.
 *
 * One builder rather than two copies: the draft path and the direct path differ
 * only in how the message is delivered, and the day somebody adds a field to one
 * of them is the day the two start producing different mail depending on which
 * permission the tenant happened to grant.
 */
function graphMessage(mail: OutboundMail) {
  return {
    subject: mail.subject,
    // HTML when there is any, because Graph carries one body rather than the
    // multipart alternative SMTP builds. The plain text is what every client
    // can already render from HTML; the reverse is not true.
    body: mail.html
      ? { contentType: "HTML", content: mail.html }
      : { contentType: "Text", content: mail.text },
    toRecipients: [{ emailAddress: { address: mail.to } }],
    ...(mail.replyTo
      ? { replyTo: [{ emailAddress: { address: mail.replyTo } }] }
      : {}),
    // Only `X-` headers are allowed here by Graph, which is exactly what
    // `X-Deskly-Ticket-Id` is. `In-Reply-To` and `References` cannot be set this
    // way — they need extended MAPI properties — so a reply threads on the
    // subject tag and this header instead, which is the pair inbound already
    // matches on. See InboundEmail.ticketIdHeader.
    //
    // That is also why losing the draft path costs less than it looks: this
    // header travels either way, so the desk still files a reply on the right
    // ticket. What is lost is the recipient's own client grouping the thread.
    ...(mail.headers
      ? {
          internetMessageHeaders: Object.entries(mail.headers)
            .filter(([name]) => name.toLowerCase().startsWith("x-"))
            .map(([name, value]) => ({ name, value })),
        }
      : {}),
  };
}

/** Sentinel: the draft call came back 403, so this app holds only `Mail.Send`. */
const DRAFT_REFUSED = Symbol("draft-refused");

/**
 * Sends as the 365 mailbox, through the Graph API.
 *
 * Two ways out, and which one is used depends on what the app registration was
 * actually granted rather than on configuration.
 *
 * The preferred way is two calls: create a draft, read the `internetMessageId`
 * Exchange stamped on it, then send that draft. `POST /sendMail` would do it in
 * one request but answers 202 with no body and therefore no Message-ID, and the
 * threading chain here is built from what the PREVIOUS send returned — without
 * an id every mail in a conversation references nothing. The extra round trip
 * buys that id.
 *
 * But creating a draft writes to the mailbox, so it needs `Mail.ReadWrite` —
 * the same permission the inbox reader uses, and a SEPARATE one from the
 * `Mail.Send` that sending itself needs. An app granted only `Mail.Send` can
 * send perfectly well and cannot draft at all, which is not a hypothetical: it
 * is the state a tenant is in when somebody has consented to the send
 * permission and not the other. Refusing to send at all there would be the
 * wrong answer — the desk would sit silent while holding a working credential.
 *
 * So a 403 on the draft is not fatal. It is taken as the answer to "may this
 * app write to the mailbox", remembered for the life of the process, and every
 * send from then on goes direct. The cost is the threading id, and the mails
 * still carry `X-Deskly-Ticket-Id` and the subject tag — the pair inbound
 * matches on anyway, so a reply still lands on its ticket; it is the recipient's
 * mail client that stops grouping the conversation.
 *
 * The From is the mailbox in the URL, not `SMTP_FROM`: an app-only token sends
 * as whichever mailbox it names, and Exchange will not let it claim another
 * address. `GRAPH_MAILBOX` is therefore both where mail is read and where it is
 * sent from, which is what a support address usually is.
 */
class GraphMailSender implements IMailSender {
  readonly transport = "graph";

  /**
   * Whether this app may write drafts, as answered by the mailbox itself.
   *
   * Starts optimistic and only ever goes false, on the first 403 from the draft
   * call. Not read from configuration, because the question is not one an
   * operator should have to answer — the permission either was consented to or
   * was not, and the tenant knows. Per process, so a grant added later takes
   * effect at the next restart rather than never.
   */
  private mayDraft = true;

  async send(mail: OutboundMail): Promise<SendResult> {
    if (this.mayDraft) {
      const drafted = await this.sendAsDraft(mail);
      if (drafted !== DRAFT_REFUSED) return drafted;
      this.mayDraft = false;
      logger.warn(
        { mailbox: env.integrations.graph.mailbox },
        "Graph refused to create a draft (needs Mail.ReadWrite) — sending direct from now on, without a Message-ID for threading",
      );
    }
    return this.sendDirect(mail);
  }

  /**
   * One call, no id back. Needs only `Mail.Send`.
   *
   * `saveToSentItems` is left at its default (true) rather than turned off: a
   * support mailbox with no record of what it sent is a support mailbox nobody
   * can audit, and writing to Sent Items is covered by `Mail.Send` itself.
   */
  private async sendDirect(mail: OutboundMail): Promise<SendResult> {
    const box = encodeURIComponent(env.integrations.graph.mailbox!);
    const res = await graphFetch(`/users/${box}/sendMail`, {
      method: "POST",
      body: JSON.stringify({ message: graphMessage(mail) }),
    });
    if (!res.ok) {
      throw new Error(
        `Graph sendMail failed (${res.status}): ${await safeText(res)}`,
      );
    }
    // Deliberately no messageId: Graph returns 202 with an empty body, and
    // inventing one would put a Message-ID in the thread chain that no mail
    // server ever stamped — a reference to a message that does not exist.
    return { transport: this.transport };
  }

  private async sendAsDraft(
    mail: OutboundMail,
  ): Promise<SendResult | typeof DRAFT_REFUSED> {
    const { mailbox } = env.integrations.graph;
    const box = encodeURIComponent(mailbox!);

    const draft = await graphFetch(`/users/${box}/messages`, {
      method: "POST",
      body: JSON.stringify(graphMessage(mail)),
    });
    // 403 is the mailbox answering "you may not write here" — see `mayDraft`.
    // Every other failure is a real one and still throws: a 401 is a broken
    // credential and a 404 a mailbox that does not exist, and silently sending
    // direct on either would turn a misconfiguration into mail that quietly
    // loses its threading forever.
    if (draft.status === 403) return DRAFT_REFUSED;
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
