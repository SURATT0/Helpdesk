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
   * put it there, so it round-trips through the correspondent's mail client),
   * OR a public-intake reference like `[BF-20260921-0042]` (the only tag on a
   * reply to an intake confirmation — see `parseTicketRef`) — AND the sender
   * is allowed to append to that ticket. The mail becomes a public comment
   * with `channel: "email"`, so web and email messages share ONE ordered
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
      // no customer-bound staff can ever see (ticketScopeWhere matches staff on
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
    //
    // Three ways to name a ticket now, tried in this order:
    //
    //   1. `ticketIdHeader` — X-Deskly-Ticket-Id, present only when a client
    //      quoted our own headers back. Unambiguous when it is there.
    //   2. `ref.ticketId` — the numeric `[Deskly #123]` / `[#123]` tag, which
    //      IS the id (see TICKET_REF_PATTERN's own comment).
    //   3. `ref.ticketNumber` — the public-intake reference
    //      (`[BF-20260921-0042]`, see PUBLIC_TICKET_REF_PATTERN), which is
    //      NOT the id and needs this one extra lookup to become one. A
    //      reply to an intake confirmation carries only this form; there is
    //      no numeric tag on that mail for (1) or (2) to have found.
    //
    // The subject tag is what survives every client, but it is also the one a
    // person edits, deletes, or has rewritten by an app tidying up prefixes;
    // the header is only there when a client quoted ours back.
    //
    // NONE of these three are TRUSTED — all are attacker-supplied strings —
    // which is why the decision below is still `senderMayReply`, not the
    // identifier.
    const ref = parseTicketRef(mail.subject);
    let targetTicketId = mail.ticketIdHeader ?? ref.ticketId;
    if (targetTicketId == null && ref.ticketNumber != null) {
      targetTicketId = await ticketRepository.findIdByNumber(ref.ticketNumber);
    }
    if (targetTicketId != null) {
      const target = await emailRepository.findReplyTarget(
        targetTicketId,
        requesterId,
      );
      // An unknown or unauthorized reference is NOT an error: fall through and
      // open a new ticket so the mail is never dropped on the floor.
      //
      // Deliberately NOT subject to the closed-conversation lock that
      // `commentService.create` applies to the in-app composer and the agent's
      // email reply. That lock exists to stop somebody writing into a thread
      // nobody is watching; refusing HERE would not stop them writing, it would
      // throw away a mail already sent, which is worse. So a reply to a ticket
      // that has since closed still lands on the thread.
      //
      // It lands silently, though, and that is a real gap rather than a settled
      // answer: nothing reopens the ticket and nothing tells the desk. Making it
      // reopen, or filing it as a new ticket that cites the old one, is a
      // product decision and is not taken here.
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
    //
    // The category has to come from the REQUESTER's tenant, not from the
    // platform. Every category belongs to a customer now, and a ticket may only
    // carry one of its own — so resolving `EMAIL_DEFAULT_CATEGORY` globally would
    // hand a Globex sender an Acme row and the write would be refused.
    const requesterCustomerId = await emailRepository.findCustomerIdOfUser(
      requesterId,
    );
    if (requesterCustomerId == null) {
      throw BadRequest(
        `Sender ${mail.from} belongs to no customer, so there is no tenant to file the mail under`,
      );
    }
    const categoryId = await emailRepository.resolveCategoryId(
      requesterCustomerId,
      env.integrations.email.defaultCategory,
    );
    if (categoryId == null) {
      throw BadRequest(
        "That customer has no category to route email tickets to",
      );
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
