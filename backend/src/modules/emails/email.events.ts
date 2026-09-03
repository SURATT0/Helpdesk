import type { DisplayStatus, Priority } from "../../shared/domain";

/**
 * The outbound ticket-email vocabulary: what can be mailed, to whom, and what
 * each mail is allowed to carry.
 *
 * This module is the OUTBOUND half of email. `modules/integrations/email` is the
 * inbound half — the webhook that turns a mail into a ticket or a comment. They
 * meet in exactly one place, `email.parsers.ts`, which owns the `[Deskly #id]`
 * subject tag both sides depend on; nothing else is shared, and neither imports
 * the other's service.
 */

/**
 * Every event that can produce mail. The string is stored in
 * `email_outbox.event_type`, so these values are data — renaming one needs a
 * migration, not just an edit.
 */
export const EMAIL_EVENTS = [
  // → the requester
  "ticket.created",
  "comment.public_reply",
  "ticket.pending",
  "ticket.auto_close_reminder",
  "ticket.closed",
  // → the assignee
  "ticket.assigned",
  "comment.requester_replied",
  "ticket.closure_rejected",
  "comment.internal_note",
  "ticket.sla_warning",
  "ticket.sla_breach",
  // → whoever holds the queue, when nobody is assigned
  "queue.ticket_unassigned",
  "queue.requester_replied",
  // → collapsed summaries, minted by the sweep rather than by an event
  "digest.multiple_updates",
  "digest.bulk_assigned",
] as const;

export type EmailEvent = (typeof EMAIL_EVENTS)[number];

export function isEmailEvent(value: unknown): value is EmailEvent {
  return typeof value === "string" && (EMAIL_EVENTS as readonly string[]).includes(value);
}

/**
 * Who an event is written for.
 *
 * This is not a label — it selects the PAYLOAD TYPE, and the requester's type
 * has no field for internal commentary or linked problems to sit in. The rule
 * "a requester never sees an internal note" is therefore enforced by the shape
 * of the data rather than by a filter somebody has to remember to apply: there
 * is nowhere to put the note.
 */
export type Audience = "requester" | "staff";

/**
 * Events addressed to the person who raised the ticket. Anything not on this
 * list may never be queued with `audience: "requester"` — `assertAudience`
 * below is the check, and it throws rather than degrading, because a wrong
 * answer here is the one failure this feature must not have.
 */
export const REQUESTER_EVENTS = new Set<EmailEvent>([
  "ticket.created",
  "comment.public_reply",
  "ticket.pending",
  "ticket.auto_close_reminder",
  "ticket.closed",
  "digest.multiple_updates",
]);

/** The ticket facts every mail carries, whoever is reading. */
export type TicketSummary = {
  id: number;
  subject: string;
  /**
   * The DISPLAYED status (New / In Progress / Pending / Closed), never the
   * stored one — `tickets.status` has no `in_progress` value and rendering it
   * raw would tell a requester their ticket is "new" while somebody is working
   * on it. Derived once by the caller via `getDisplayStatus`.
   */
  displayStatus: DisplayStatus;
  priority: Priority;
  category: string;
  requesterName: string;
  assigneeName: string | null;
};

/** The message that caused this mail, when one did. */
export type MessageSummary = {
  authorName: string;
  /** The latest message only. A whole thread is never mailed — it is a link. */
  body: string;
};

type BasePayload = {
  ticket: TicketSummary;
  /** When the event happened, ISO 8601 with offset. Rendered with a named zone. */
  occurredAt: string;
  message?: MessageSummary;
  /** Free-form per-event values interpolated into the template. */
  vars?: Record<string, string | number>;
};

/**
 * What a requester may be told. Deliberately narrower than the staff payload:
 * no linked problem, no internal note, no per-agent workload — the three things
 * the spec forbids leaking outward have no field here at all.
 */
export type RequesterPayload = BasePayload & { audience: "requester" };

/** What the desk may be told — everything above, plus the internal context. */
export type StaffPayload = BasePayload & {
  audience: "staff";
  /** The problem this incident is linked to. Internal; never mailed outward. */
  problem?: { id: number; title: string };
};

export type EmailPayload = RequesterPayload | StaffPayload;

/**
 * Refuse to compose a requester-bound mail for a staff-only event.
 *
 * The recipient rules in `email.recipients.ts` already make this unreachable —
 * an internal note resolves to a recipient list the requester is not in. This
 * is the second lock, placed on the other side of the door: it fires at enqueue
 * time, before any template runs, so a future event added to the catalog
 * without a recipient rule fails loudly here instead of quietly mailing an
 * internal note to the person it was hidden from.
 */
export function assertAudience(event: EmailEvent, audience: Audience): void {
  if (audience === "requester" && !REQUESTER_EVENTS.has(event)) {
    throw new Error(
      `Refusing to queue "${event}" for a requester: it is a staff-only event. ` +
        "If this event really is safe to send outward, add it to REQUESTER_EVENTS " +
        "and give it a requester template — do not widen this check.",
    );
  }
}
