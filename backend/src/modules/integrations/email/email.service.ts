import { env } from "../../../config/env";
import { BadRequest } from "../../../shared/errors";
import { ticketRepository } from "../../tickets/ticket.repository";
import { commentRepository } from "../../comments/comment.repository";
import { emailRepository } from "./email.repository";
import { derivePriority, parseTicketRef } from "./email.parsers";
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
    };
  },

  /**
   * Turn one inbound email into either a reply on an existing ticket or a new
   * ticket.
   *
   * Reply path — the subject carries a `[#123]` tag (our own outbound replies
   * put it there, so it round-trips through the correspondent's mail client) AND
   * the sender is allowed to append to that ticket. The mail becomes a public
   * comment with `channel: "email"`, so web and email messages share ONE ordered
   * thread; the channel is only a badge, never a filter.
   *
   * Ticket path — everything else. The sender becomes the requester (created on
   * the fly if unknown, unless disabled); the priority is read from a subject tag
   * like `[urgent]`; the category defaults to EMAIL_DEFAULT_CATEGORY (or the
   * first category). Reuses the ticket repository's create path, so the
   * status-history row, SLA due date, audit entry, and notifications all fire as
   * for any other ticket.
   */
  async ingest(mail: InboundEmail): Promise<IngestResult> {
    // Providers retry webhooks; a Message-ID we've already stored means this
    // exact mail is already in a thread. Bail before creating anything.
    if (mail.messageId) {
      const seen = await commentRepository.findByMessageId(mail.messageId);
      if (seen) {
        return {
          kind: "duplicate",
          ticketId: seen.ticketId,
          requesterId: 0,
          requesterCreated: false,
          commentId: seen.id,
        };
      }
    }

    const known = await ticketRepository.findUserIdByEmail(mail.from);
    let requesterId: number;
    let requesterCreated = false;
    if (known != null) {
      requesterId = known;
    } else if (env.integrations.email.createUnknownRequester) {
      // An unknown sender has to be filed under a tenant explicitly. Without one
      // the requester, and then the ticket, would carry customerId null — which
      // no agent or manager can ever see (ticketScopeWhere matches staff on
      // customerId equality). Refusing is loud; filing it invisibly is silent.
      const configured = env.integrations.email.defaultCustomer;
      const customerId = configured
        ? await emailRepository.resolveCustomerId(configured)
        : null;
      if (customerId == null) {
        throw BadRequest(
          configured
            ? `EMAIL_DEFAULT_CUSTOMER names no existing customer ("${configured}"), so mail from unknown sender ${mail.from} cannot be filed under a tenant`
            : `Sender ${mail.from} is not a known user and EMAIL_DEFAULT_CUSTOMER is not set, so there is no tenant to file the mail under`,
        );
      }
      const r = await emailRepository.findOrCreateRequester(
        mail.from,
        mail.fromName,
        customerId,
      );
      requesterId = r.id;
      requesterCreated = r.created;
    } else {
      throw BadRequest(`Sender ${mail.from} is not a known user`);
    }

    // --- reply path ---
    const ref = parseTicketRef(mail.subject);
    if (ref.ticketId != null) {
      const target = await emailRepository.findReplyTarget(
        ref.ticketId,
        requesterId,
      );
      // An unknown or unauthorized reference is NOT an error: fall through and
      // open a new ticket so the mail is never dropped on the floor.
      if (target?.senderMayReply) {
        const comment = await commentRepository.create({
          ticketId: target.id,
          authorId: requesterId,
          body: mail.text.trim() || "(email had no text body)",
          internal: false,
          channel: "email",
          messageId: mail.messageId ?? null,
        });
        return {
          kind: "comment",
          ticketId: target.id,
          requesterId,
          requesterCreated,
          commentId: comment.id,
        };
      }
    }

    // --- new-ticket path ---
    const categoryId = await emailRepository.resolveCategoryId(
      env.integrations.email.defaultCategory,
    );
    if (categoryId == null) {
      throw BadRequest("No category exists to route email tickets to");
    }

    // Strip a stale/unauthorized [#id] tag out of the new ticket's subject so it
    // doesn't look like it belongs to another ticket.
    const { priority, subject } = derivePriority(ref.subject);
    const ticket = await ticketRepository.create({
      subject: subject || "(no subject)",
      description: mail.text.trim() || "(email had no text body)",
      priority,
      categoryId,
      requesterId,
    });

    return { kind: "ticket", ticketId: ticket.id, requesterId, requesterCreated };
  },
};
