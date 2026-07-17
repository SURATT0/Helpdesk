import { env } from "../../../config/env";
import { BadRequest } from "../../../shared/errors";
import { ticketRepository } from "../../tickets/ticket.repository";
import { emailRepository } from "./email.repository";
import { derivePriority } from "./email.parsers";
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
   * Turn one inbound email into a ticket. The sender becomes the requester
   * (created on the fly if unknown, unless disabled); the priority is read from
   * a subject tag like `[urgent]`; the category defaults to EMAIL_DEFAULT_CATEGORY
   * (or the first category). Reuses the ticket repository's create path, so the
   * status-history row, SLA due date, audit entry, and notifications all fire as
   * for any other ticket.
   */
  async ingest(mail: InboundEmail): Promise<IngestResult> {
    const categoryId = await emailRepository.resolveCategoryId(
      env.integrations.email.defaultCategory,
    );
    if (categoryId == null) {
      throw BadRequest("No category exists to route email tickets to");
    }

    const known = await ticketRepository.findUserIdByEmail(mail.from);
    let requesterId: number;
    let requesterCreated = false;
    if (known != null) {
      requesterId = known;
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

    const { priority, subject } = derivePriority(mail.subject);
    const ticket = await ticketRepository.create({
      subject: subject || "(no subject)",
      description: mail.text.trim() || "(email had no text body)",
      priority,
      categoryId,
      requesterId,
    });

    return { ticketId: ticket.id, requesterId, requesterCreated };
  },
};
