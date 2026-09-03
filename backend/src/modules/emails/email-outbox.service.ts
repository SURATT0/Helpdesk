import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../shared/db";
import { logger } from "../../shared/logger";
import { t } from "../../shared/i18n";
import { auditRepository } from "../audit/audit.repository";
import { mailSender } from "../integrations/email/mail-sender";
import {
  assertAudience,
  type EmailEvent,
  type EmailPayload,
  type MessageSummary,
  type TicketSummary,
} from "./email.events";
import {
  audienceOf,
  emailRecipients,
  type RecipientContext,
} from "./email.recipients";
import {
  emailOutboxRepository,
  type ClaimedEmail,
  type OutboxEntry,
} from "./email-outbox.repository";
import { renderEmail } from "./email.templates";

type Db = Prisma.TransactionClient | typeof prisma;

/** What a call site hands over when something worth mailing about happens. */
export type QueueRequest = {
  event: EmailEvent;
  ctx: RecipientContext;
  /**
   * The row that caused this — a comment id, a status-history id, the ticket id
   * for events with no record of their own, or the new assignee's id for an
   * assignment. Half the idempotency key, so it must identify the CAUSE and not
   * just the ticket: using the ticket id for a per-comment event would mail the
   * first comment and silently swallow every one after it.
   */
  sourceRecordId: number;
  ticket: TicketSummary;
  occurredAt: Date;
  message?: MessageSummary;
  vars?: Record<string, string | number>;
  /** Internal context. Reaches staff payloads only — see `email.events`. */
  problem?: { id: number; title: string };
  /**
   * Deliver the REQUESTER's copy to this address instead of their account's.
   *
   * The agent reply composer's editable To: field, and nothing else. Overrides
   * the delivery address only — the recipient, their audience and their language
   * still come from the rules, so it cannot redirect a staff-only event outward
   * or hand a requester a staff payload.
   */
  deliverTo?: string;
};

export const emailOutboxService = {
  /**
   * Queue the mail for one event, inside the caller's transaction.
   *
   * Recipients are decided FIRST, then a payload is built for each of them. That
   * order is the whole safety design: an internal note's recipient list never
   * contains the requester, so the requester's payload is never built, so there
   * is no message for a later bug to mis-deliver. Composing first and filtering
   * afterwards would leave the note sitting in a string that only a correct
   * filter keeps out of the wrong inbox.
   *
   * Never throws for a delivery reason. A ticket whose requester has no usable
   * address, a category with no queue team, an event switched off — all of these
   * record why and return, because the user's action must not fail because a
   * mail could not be addressed.
   */
  async queue(req: QueueRequest, db: Db = prisma): Promise<number> {
    const resolution = await emailRecipients.forEvent(req.event, req.ctx, db);

    if (resolution.recipients.length === 0) {
      // Nobody to write to. Recorded rather than raised: the Activity log is
      // where "we deliberately told no one" has to be visible, and it is the
      // only trace a category with no queue team leaves behind.
      await auditRepository.record(
        {
          userId: req.ctx.actorId ?? null,
          action: "email.suppressed",
          entity: "ticket",
          entityId: req.ctx.ticketId,
          meta: {
            eventType: req.event,
            reason: resolution.reason,
            recipient: null,
          },
        },
        db,
      );
      return 0;
    }

    const audience = audienceOf(req.event);
    // Second lock, on the far side of the recipient rules. Unreachable today by
    // construction; it exists so a future event added without a recipient rule
    // fails here instead of mailing a note outward.
    assertAudience(req.event, audience);

    const entries: OutboxEntry[] = resolution.recipients.map((r) => {
      const base = {
        ticket: req.ticket,
        occurredAt: req.occurredAt.toISOString(),
        message: req.message,
        vars: { ...req.vars, recipientName: r.name },
      };
      const payload: EmailPayload =
        r.audience === "requester"
          ? { ...base, audience: "requester" }
          : { ...base, audience: "staff", problem: req.problem };
      return {
        ticketId: req.ctx.ticketId,
        eventType: req.event,
        sourceRecordId: req.sourceRecordId,
        recipientUserId: r.userId,
        // The override applies to the requester's copy alone. Staff on the same
        // event keep their own addresses — an agent redirecting their reply must
        // not also redirect the desk's internal traffic.
        recipientEmail:
          r.audience === "requester" && req.deliverTo ? req.deliverTo : r.email,
        lang: r.lang,
        payload,
      };
    });

    return emailOutboxRepository.enqueue(entries, db);
  },

  /**
   * Deliver what is due.
   *
   * Runs on a timer rather than inside the mutations that queue the work, for
   * the reason the outbox pattern exists: those writes are transactional, and
   * mailing from inside one would send for work that later rolls back and would
   * put a mail server on the critical path of every comment and status change.
   *
   * Per-row failures are isolated and rescheduled with exponential backoff; one
   * dead address never stalls the batch, and a provider that is down simply
   * leaves everything pending for the next pass.
   */
  async sweep(now: Date = new Date()): Promise<{
    sent: number;
    failed: number;
    suppressed: number;
    collapsed: number;
  }> {
    const cfg = env.ticketEmail;
    // Lease long enough that a slow SMTP handshake cannot let a second instance
    // claim the same row, short enough that a crashed worker frees it soon.
    const claimed = await emailOutboxRepository.claimDue(
      cfg.batchLimit,
      Math.max(cfg.backoffBaseMs, 60_000),
      now,
    );
    if (claimed.length === 0) {
      return { sent: 0, failed: 0, suppressed: 0, collapsed: 0 };
    }

    const totals = { sent: 0, failed: 0, suppressed: 0, collapsed: 0 };
    const bulkGroups = groupBulkAssignments(claimed);
    const handledByBulk = new Set(
      [...bulkGroups.values()].flat().map((c) => c.id),
    );

    for (const [, group] of bulkGroups) {
      try {
        await this.deliverBulkDigest(group, now, totals);
      } catch (err) {
        for (const row of group) await this.recordFailure(row, err, now, totals);
      }
    }

    for (const row of claimed) {
      if (handledByBulk.has(row.id)) continue;
      try {
        await this.deliverOne(row, now, totals);
      } catch (err) {
        await this.recordFailure(row, err, now, totals);
      }
    }

    return totals;
  },

  /** One queued mail: switches, rate limit, threading, send, audit. */
  async deliverOne(
    row: ClaimedEmail,
    now: Date,
    totals: { sent: number; suppressed: number; collapsed: number },
  ): Promise<void> {
    const cfg = env.ticketEmail;

    if (!cfg.enabled || cfg.disabledEvents.has(row.eventType)) {
      await this.suppress(row, "event_disabled", totals);
      return;
    }

    // --- anti-spam: at most N per ticket per window, per recipient -----------
    const windowStart = new Date(now.getTime() - cfg.rateWindowMs);
    const sentInWindow = await emailOutboxRepository.countSentSince(
      row.ticketId,
      row.recipientUserId,
      windowStart,
    );
    if (sentInWindow >= cfg.ratePerTicket) {
      // Already over. One summary stands for everything in the window; a second
      // summary would be the flood the limit exists to stop, so it is sent only
      // if there isn't one yet.
      const digestsSent = await emailOutboxRepository.countSentSince(
        row.ticketId,
        row.recipientUserId,
        windowStart,
        "digest.multiple_updates",
      );
      const siblings = await emailOutboxRepository.pendingFor(
        row.ticketId,
        row.recipientUserId,
        row.id,
      );
      if (digestsSent > 0) {
        await emailOutboxRepository.markCollapsed([row.id, ...siblings], row.id);
        totals.collapsed += 1 + siblings.length;
        return;
      }
      await this.send(
        { ...row, eventType: "digest.multiple_updates" },
        { ...row.payload, vars: { ...row.payload.vars, count: 1 + siblings.length } },
        now,
        totals,
      );
      await emailOutboxRepository.markCollapsed(siblings, row.id);
      totals.collapsed += siblings.length;
      return;
    }

    await this.send(row, row.payload, now, totals);
  },

  /**
   * The 20-tickets-at-once case: one summary per recipient instead of twenty
   * mails.
   *
   * Collapsed at delivery rather than at queue time because the queue writes
   * happen one ticket at a time inside separate transactions — nothing there
   * knows it is part of a batch. The sweep sees them together, which is the
   * first moment the batch exists as a fact.
   *
   * The summary is filed under the first ticket's number so the subject keeps
   * the `[Deskly #id]` shape every mail is required to carry; the body lists
   * them all. A reply therefore threads onto that first ticket — acceptable for
   * a notice nobody is expected to answer, and better than twenty mails.
   */
  async deliverBulkDigest(
    group: ClaimedEmail[],
    now: Date,
    totals: { sent: number; suppressed: number; collapsed: number },
  ): Promise<void> {
    const cfg = env.ticketEmail;
    const [head, ...rest] = group;
    if (!cfg.enabled || cfg.disabledEvents.has("ticket.assigned")) {
      for (const row of group) await this.suppress(row, "event_disabled", totals);
      return;
    }
    const list = group
      .map((r) => `#${r.ticketId} ${r.payload.ticket.subject}`)
      .join("\n");
    await this.send(
      { ...head, eventType: "digest.bulk_assigned" },
      {
        ...head.payload,
        vars: { ...head.payload.vars, count: group.length, ticketList: list },
        message: { authorName: "", body: list },
      },
      now,
      totals,
    );
    await emailOutboxRepository.markCollapsed(
      rest.map((r) => r.id),
      head.id,
    );
    totals.collapsed += rest.length;
  },

  /** Render, hand to the transport, record the outcome. */
  async send(
    row: ClaimedEmail,
    payload: EmailPayload,
    now: Date,
    totals: { sent: number },
  ): Promise<void> {
    const anchors = await emailOutboxRepository.threadAnchors(
      row.ticketId,
      row.recipientUserId,
    );
    const rendered = renderEmail(row.eventType, payload, row.lang, {
      webOrigin: env.webOrigin,
    });
    const replyTo = env.smtp.from || undefined;
    const result = await mailSender.send({
      from: replyTo ?? row.recipientEmail,
      to: row.recipientEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      replyTo,
      inReplyTo: anchors.last,
      // Root first, then the message being answered — the order a client walks
      // to rebuild a conversation. Deduplicated for the second mail in a thread,
      // where the root IS the last.
      references: [anchors.root, anchors.last].filter(
        (v, i, a): v is string => Boolean(v) && a.indexOf(v) === i,
      ),
      headers: {
        // The header the inbound side can match on when a subject tag has been
        // edited away. Belt to the subject tag's braces.
        "X-Deskly-Ticket-Id": String(row.ticketId),
      },
    });
    await emailOutboxRepository.markSent(row.id, result.messageId, now);
    await auditRepository.record({
      userId: null,
      action: "email.sent",
      entity: "ticket",
      entityId: row.ticketId,
      meta: {
        eventType: row.eventType,
        recipient: row.recipientEmail,
        transport: result.transport,
        outboxId: row.id,
      },
    });
    totals.sent += 1;
  },

  async suppress(
    row: ClaimedEmail,
    reason: string,
    totals: { suppressed: number },
  ): Promise<void> {
    await emailOutboxRepository.markSuppressed(row.id, reason);
    await auditRepository.record({
      userId: null,
      action: "email.suppressed",
      entity: "ticket",
      entityId: row.ticketId,
      meta: {
        eventType: row.eventType,
        recipient: row.recipientEmail,
        reason,
      },
    });
    totals.suppressed += 1;
  },

  /**
   * A send that threw. Back off and try again, or give up and say so.
   *
   * `attempts` was already incremented when the row was claimed, so a row that
   * has used its last attempt is terminal here rather than after one more pass.
   */
  async recordFailure(
    row: ClaimedEmail,
    err: unknown,
    now: Date,
    totals: { failed: number },
  ): Promise<void> {
    const cfg = env.ticketEmail;
    const message = err instanceof Error ? err.message : String(err);
    if (row.attempts >= cfg.maxAttempts) {
      await emailOutboxRepository.markFailed(row.id, message);
      await auditRepository.record({
        userId: null,
        action: "email.failed",
        entity: "ticket",
        entityId: row.ticketId,
        meta: {
          eventType: row.eventType,
          recipient: row.recipientEmail,
          attempts: row.attempts,
          error: message,
        },
      });
      totals.failed += 1;
      logger.warn(
        { outboxId: row.id, ticketId: row.ticketId, attempts: row.attempts },
        "giving up on a notification email after the last attempt",
      );
      return;
    }
    // 1m → 5m → 25m. Multiplicative, so a provider outage is retried a few times
    // over half an hour rather than hammered once a minute by the whole queue.
    const delay = cfg.backoffBaseMs * Math.pow(5, row.attempts - 1);
    await emailOutboxRepository.reschedule(
      row.id,
      new Date(now.getTime() + delay),
      message,
    );
    logger.info(
      { outboxId: row.id, attempt: row.attempts, retryInMs: delay },
      "notification email failed; rescheduled",
    );
  },
};

/**
 * Assignment rows that belong to one recipient, when there is more than one of
 * them in this batch. A single assignment is left alone — a summary of one is
 * worse than the mail it replaces.
 */
function groupBulkAssignments(
  claimed: ClaimedEmail[],
): Map<number, ClaimedEmail[]> {
  const byRecipient = new Map<number, ClaimedEmail[]>();
  for (const row of claimed) {
    if (row.eventType !== "ticket.assigned") continue;
    const list = byRecipient.get(row.recipientUserId) ?? [];
    list.push(row);
    byRecipient.set(row.recipientUserId, list);
  }
  for (const [id, list] of byRecipient) {
    if (list.length < 2) byRecipient.delete(id);
  }
  return byRecipient;
}

export const __testing = { groupBulkAssignments, t };
