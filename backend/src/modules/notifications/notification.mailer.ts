import { env } from "../../config/env";
import { mailSender } from "../integrations/email/mail-sender";
import { ensureTicketRef } from "../integrations/email/email.parsers";

/** A pending notification joined to its recipient, as the sweep reads it. */
export type PendingNotification = {
  id: number;
  type: string;
  ticketId: number | null;
  message: string;
  recipient: { id: number; name: string; email: string };
};

/**
 * Notification types that are deliberately NOT emailed.
 *
 * Internal notes are agent-to-agent shorthand; mailing them would push internal
 * commentary into a mailbox where a forward could expose it outside the ticket.
 * The in-app bell still shows them.
 */
const NO_EMAIL_TYPES = new Set<string>(["ticket.internal_note"]);

/** Subject line per notification type. Falls back to the stored message. */
function subjectFor(n: PendingNotification): string {
  const base = (() => {
    switch (n.type) {
      case "ticket.comment":
        return "New reply on your ticket";
      case "ticket.assigned":
        return "A ticket was assigned to you";
      case "ticket.status_change":
        return "Ticket status changed";
      case "ticket.sla_warning":
        return "Ticket approaching its SLA";
      case "ticket.sla_breach":
        return "Ticket has breached its SLA";
      default:
        return n.message;
    }
  })();
  // Carry the ticket ref so a reply threads back onto the ticket rather than
  // opening a new one — the same token the agent reply path stamps.
  return n.ticketId != null ? ensureTicketRef(base, n.ticketId) : base;
}

function bodyFor(n: PendingNotification): string {
  const lines = [`Hi ${n.recipient.name},`, "", n.message];
  if (n.ticketId != null) {
    lines.push("", `View it here: ${env.webOrigin}/tickets/${n.ticketId}`);
  }
  lines.push(
    "",
    "—",
    "You are receiving this because you are a participant on this ticket.",
    "Reply to this email to add to the ticket conversation.",
  );
  return lines.join("\n");
}

export type DeliveryOutcome = "sent" | "skipped";

/**
 * Where replies to a notification email should go: the shared helpdesk address,
 * which is the same inbox that feeds the inbound webhook. Reuses `SMTP_FROM`
 * rather than introducing a second variable, matching what `reply.service` does
 * for an agent's reply — one help desk identity, one place to configure it.
 *
 * Returns undefined when unset rather than falling back to an individual's
 * address: no Reply-To is a visibly broken loop, a personal one is an invisibly
 * broken one.
 */
function systemReplyAddress(): string | undefined {
  return env.smtp.from || undefined;
}

export const notificationMailer = {
  /**
   * Mail one pending notification.
   *
   * Returns `"skipped"` for types that are intentionally in-app only, or when the
   * recipient has no usable address. The caller stamps `emailedAt` either way:
   * a skip is a final decision, not a failure, so it must not be retried on every
   * pass. Genuine send FAILURES throw, leaving the row pending for the next run.
   */
  async deliver(n: PendingNotification): Promise<DeliveryOutcome> {
    if (NO_EMAIL_TYPES.has(n.type)) return "skipped";
    if (!n.recipient.email.includes("@")) return "skipped";

    const replyTo = systemReplyAddress();
    await mailSender.send({
      from: replyTo ?? n.recipient.email,
      to: n.recipient.email,
      subject: subjectFor(n),
      text: bodyFor(n),
      replyTo,
    });
    return "sent";
  },
};

export const __testing = { subjectFor, bodyFor, NO_EMAIL_TYPES };
