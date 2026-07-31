import { env } from "../../../config/env";
import { BadRequest } from "../../../shared/errors";
import { logger } from "../../../shared/logger";
import { commentService } from "../../comments/comment.service";
import { ticketRepository } from "../../tickets/ticket.repository";
import { emailRepository } from "./email.repository";
import { derivePriority, parseTicketRef } from "./email.parsers";
import { maySenderPostOnTicket } from "./email.thread";
import type { EmailStatus, InboundEmail, IngestResult } from "./email.types";

const WEBHOOK_PATH = "/api/v1/integrations/email-inbound";

export const emailService = {
  /** Availability of the email-to-ticket surfaces, for the settings UI. */
  status(): EmailStatus {
    const { imap, email } = env.integrations;
    return {
      webhookEnabled: Boolean(email.webhookSecret),
      endpoint: WEBHOOK_PATH,
      imapConfigured: Boolean(imap.host && imap.user && imap.password),
      replyToConfigured: Boolean(env.smtp.replyTo || env.smtp.from),
    };
  },

  /**
   * File one inbound email. Three outcomes, in priority order:
   *
   *   duplicate — this Message-ID is already stored (provider retry): no write.
   *   threaded  — the mail answers an existing ticket AND the sender is allowed
   *               to post on it, so it becomes an email-channel comment.
   *   created   — anything else opens a new ticket (the original behaviour).
   *
   * Threading is what keeps the conversation inside the ticket: without it every
   * requester reply opened a fresh ticket and the thread fragmented. The ticket
   * is resolved from In-Reply-To/References first (forgery-resistant, since the
   * ids are ours) and only then from the `[#id]` subject tag, which the sender
   * controls — hence the authorization check before any write.
   *
   * Falling back to `created` on a failed authorization is deliberate: someone
   * who merely quoted a ticket number in a new request still gets a ticket
   * instead of an error, while gaining no access to the one they named.
   */
  async ingest(mail: InboundEmail): Promise<IngestResult> {
    const senderId = await ticketRepository.findUserIdByEmail(mail.from);

    // Idempotency first — a retried webhook must not double-post.
    if (mail.messageId) {
      const seen = await emailRepository.findCommentByMessageId(mail.messageId);
      if (seen) {
        return {
          ticketId: seen.ticketId,
          requesterId: senderId ?? 0,
          requesterCreated: false,
          outcome: "duplicate",
          commentId: seen.id,
        };
      }
    }

    const threaded = await tryThread(mail, senderId);
    if (threaded) return threaded;

    return createTicket(mail, senderId);
  },
};

/**
 * Attempt to append the mail to an existing ticket. Returns null whenever the
 * caller should open a new ticket instead — no target, unknown sender, or the
 * sender may not post on the target.
 */
async function tryThread(
  mail: InboundEmail,
  senderId: number | null,
): Promise<IngestResult | null> {
  // An unknown sender can never thread: there is no identity to authorize, and
  // auto-creating a requester here would hand a stranger a way onto any ticket.
  if (senderId == null) return null;

  const byHeader = mail.inReplyTo?.length
    ? await emailRepository.findTicketIdByAncestors(mail.inReplyTo)
    : null;
  const { ticketId: bySubject } = parseTicketRef(mail.subject);
  const ticketId = byHeader ?? bySubject;
  if (ticketId == null) return null;

  const [sender, target] = await Promise.all([
    emailRepository.findSender(senderId),
    emailRepository.findThreadTarget(ticketId),
  ]);
  if (!sender || !target) return null;

  if (!maySenderPostOnTicket(sender, target)) {
    // Security-relevant: someone referenced a ticket they have no part in.
    // Logged (not thrown) because the fallback still serves them a new ticket.
    logger.warn(
      { ticketId, senderId, matchedBy: byHeader != null ? "header" : "subject" },
      "inbound email referenced a ticket the sender may not post on — opening a new ticket instead",
    );
    return null;
  }

  const comment = await commentService.createFromEmail({
    ticketId,
    authorId: senderId,
    body: mail.text.trim() || "(email had no text body)",
    messageId: mail.messageId,
  });

  return {
    ticketId,
    requesterId: senderId,
    requesterCreated: false,
    outcome: "threaded",
    commentId: comment.id,
  };
}

/**
 * Open a new ticket from the mail. The sender becomes the requester (created on
 * the fly if unknown, unless disabled); the priority is read from a subject tag
 * like `[urgent]`; the category defaults to EMAIL_DEFAULT_CATEGORY (or the first
 * category). Reuses the ticket repository's create path, so the status-history
 * row, SLA due date, audit entry, and notifications all fire as for any other
 * ticket.
 */
async function createTicket(
  mail: InboundEmail,
  senderId: number | null,
): Promise<IngestResult> {
  const categoryId = await emailRepository.resolveCategoryId(
    env.integrations.email.defaultCategory,
  );
  if (categoryId == null) {
    throw BadRequest("No category exists to route email tickets to");
  }

  let requesterId: number;
  let requesterCreated = false;
  if (senderId != null) {
    requesterId = senderId;
  } else if (env.integrations.email.createUnknownRequester) {
    const r = await emailRepository.findOrCreateRequester(
      mail.from,
      mail.fromName,
    );
    requesterId = r.id;
    requesterCreated = r.created;
  } else {
    throw BadRequest(`Sender ${mail.from} is not a known user`);
  }

  // Strip any `[#id]` the sender quoted — it did not resolve to a ticket they
  // may post on, so keeping it in the title would be misleading.
  const { subject: withoutRef } = parseTicketRef(mail.subject);
  const { priority, subject } = derivePriority(withoutRef);
  const ticket = await ticketRepository.create({
    subject: subject || "(no subject)",
    description: mail.text.trim() || "(email had no text body)",
    priority,
    categoryId,
    requesterId,
  });

  return {
    ticketId: ticket.id,
    requesterId,
    requesterCreated,
    outcome: "created",
  };
}
