import { env } from "../../../config/env";
import { logger } from "../../../shared/logger";
import { graphConfigured, graphFetch, safeText } from "../email/graph-client";
import { emailService } from "../email/email.service";
import type { InboundEmail } from "../email/email.types";
import type { IMailSource, MailSyncResult } from "../source.types";

/**
 * Microsoft 365 mail, read through the Graph API.
 *
 * App-only OAuth2 (client credentials). Microsoft turned basic auth off for
 * IMAP on 365, so a host/user/password adapter cannot reach these mailboxes at
 * all; a registered application with `Mail.ReadWrite` on the tenant is the way
 * in. Nothing here is interactive — no user signs in, the app holds the grant —
 * which is what makes it usable from a background sweep.
 *
 * Messages go to `emailService.ingest()`, the same function the inbound webhook
 * calls. That is deliberate and is why this implements `IMailSource` rather
 * than `fetchTickets`: ingest already threads a reply onto the ticket it
 * answers, creates a requester for a sender nobody has seen before, and refuses
 * a Message-ID it has already stored. Routing mail through the CSV import path
 * instead would lose all three and quietly reopen a new ticket for every reply.
 */

/** Graph's shape, narrowed to the fields this reads. */
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  sender?: { emailAddress?: { address?: string; name?: string } };
};

/**
 * Turn one Graph message into the provider-agnostic shape ingest expects.
 *
 * Exported for its own test. The mapping is where a provider's quirks are
 * supposed to stop, so it is worth pinning independently of any network.
 *
 * `internetMessageId` is the RFC 5322 Message-ID and the key ingest dedups on —
 * NOT Graph's `id`, which is a per-mailbox handle: the same mail read from two
 * mailboxes carries two Graph ids and one Message-ID, and it is the Message-ID
 * that says they are the same mail.
 */
export function toInboundEmail(msg: GraphMessage): InboundEmail | null {
  const addr = (
    msg.from?.emailAddress?.address ??
    msg.sender?.emailAddress?.address ??
    ""
  )
    .trim()
    .toLowerCase();
  // No sender, nobody to file it under, and no address to answer. Skipped rather
  // than guessed at — Graph returns this for drafts and some system messages.
  if (!addr) return null;

  return {
    from: addr,
    fromName:
      msg.from?.emailAddress?.name ?? msg.sender?.emailAddress?.name ?? undefined,
    subject: msg.subject?.trim() || "(no subject)",
    // `bodyPreview` before `body.content`, because a 365 mailbox returns HTML by
    // default and the preview is the plain text Graph already extracted. Falling
    // back to raw HTML would put markup in the ticket body; stripping it here
    // would be a second, worse HTML parser living in an adapter.
    text: msg.bodyPreview?.trim() || stripHtml(msg.body?.content ?? ""),
    messageId: msg.internetMessageId,
  };
}

/** Last resort when Graph sends no preview: tags out, entities decoded, once. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export class GraphEmailSource implements IMailSource {
  readonly id = "graph-email";
  readonly label = "Microsoft 365 (Graph)";
  readonly description =
    "Read a 365 mailbox with an app registration and turn new mail into tickets.";
  readonly implemented = true;
  readonly ingestsOwnMail = true as const;

  isConfigured(): boolean {
    return graphConfigured();
  }

  /**
   * Not the path for mail — see the class comment and `IMailSource`.
   *
   * It stays on the interface because the registry and the integrations screen
   * are typed on `ITicketSource`. Throwing rather than returning `[]` so a
   * caller that reaches here has a bug reported to it instead of a silent
   * "no tickets today".
   */
  async fetchTickets(): Promise<never> {
    throw new Error(
      "GraphEmailSource ingests mail directly; call syncMail(), not fetchTickets()",
    );
  }

  async syncMail(): Promise<MailSyncResult> {
    const { mailbox, pageSize, markAsRead } = env.integrations.graph;
    const result: MailSyncResult = {
      fetched: 0,
      tickets: 0,
      comments: 0,
      duplicates: 0,
      failures: [],
    };

    // Unread only, oldest first. Oldest first matters for threading: a reply
    // ingested before the mail it answers would open its own ticket, and the
    // original would then thread onto nothing.
    const query = new URLSearchParams({
      $filter: "isRead eq false",
      $top: String(pageSize),
      $orderby: "receivedDateTime asc",
      $select: "id,internetMessageId,subject,bodyPreview,body,from,sender",
    });
    const res = await graphFetch(
      `/users/${encodeURIComponent(mailbox!)}/mailFolders/inbox/messages?${query}`,
    );
    if (!res.ok) {
      throw new Error(
        `Graph message list failed (${res.status}): ${await safeText(res)}`,
      );
    }
    const page = (await res.json()) as { value?: GraphMessage[] };
    const messages = page.value ?? [];
    result.fetched = messages.length;

    for (const msg of messages) {
      const mail = toInboundEmail(msg);
      if (!mail) {
        result.failures.push({
          messageId: msg.internetMessageId,
          reason: "no sender address",
        });
        continue;
      }
      try {
        const ingested = await emailService.ingest(mail);
        if (ingested.kind === "ticket") result.tickets++;
        else if (ingested.kind === "comment") result.comments++;
        else result.duplicates++;

        // Only after it is safely a ticket or a comment. Marking first and
        // failing second would lose the mail: unread is the only record that it
        // still needs handling.
        if (markAsRead) await this.markRead(msg.id);
      } catch (err) {
        // One unparseable mail must not stop the sweep — the next message may
        // be the one somebody is waiting on. It stays unread, so a fix plus a
        // re-run picks it up.
        const reason = err instanceof Error ? err.message : String(err);
        result.failures.push({ messageId: msg.internetMessageId, reason });
        logger.error(
          { err, messageId: msg.internetMessageId },
          "graph mail ingest failed",
        );
      }
    }
    return result;
  }

  private async markRead(id: string): Promise<void> {
    const { mailbox } = env.integrations.graph;
    const res = await graphFetch(
      `/users/${encodeURIComponent(mailbox!)}/messages/${id}`,
      { method: "PATCH", body: JSON.stringify({ isRead: true }) },
    );
    if (!res.ok) {
      // Logged, not thrown. The mail IS a ticket now; failing the sweep here
      // would report a success as a failure, and the duplicate guard in ingest
      // is what stops the next run raising it twice.
      logger.warn(
        { status: res.status, id },
        "could not mark 365 message as read; ingest already succeeded",
      );
    }
  }
}
