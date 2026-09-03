import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import type { Lang } from "../../shared/i18n";
import type { EmailEvent, EmailPayload } from "./email.events";
import type { NoRecipientReason } from "./email.recipients";

type Db = Prisma.TransactionClient | typeof prisma;

/** A row to queue. Written inside the caller's transaction, never on its own. */
export type OutboxEntry = {
  ticketId: number;
  eventType: EmailEvent;
  sourceRecordId: number;
  recipientUserId: number;
  recipientEmail: string;
  lang: Lang;
  payload: EmailPayload;
  /** Set to queue the row already decided against — a log entry, not a mail. */
  suppressedReason?: NoRecipientReason | string;
};

/** A claimed row, as the sweep works with it. */
export type ClaimedEmail = {
  id: number;
  ticketId: number;
  eventType: EmailEvent;
  recipientUserId: number;
  recipientEmail: string;
  lang: Lang;
  payload: EmailPayload;
  attempts: number;
};

type ClaimedRow = {
  id: number;
  ticket_id: number;
  event_type: string;
  recipient_user_id: number;
  recipient_email: string;
  lang: string;
  payload: unknown;
  attempts: number;
};

export const emailOutboxRepository = {
  /**
   * Queue rows inside the caller's transaction.
   *
   * `skipDuplicates` is the idempotency guarantee doing its work: the unique
   * key is (ticket, event, cause, recipient), so replaying the same event —
   * a retried request, a sweep re-examining the same ticket, two instances
   * racing — inserts nothing the second time instead of queueing a second mail.
   * Silently skipping is right here precisely because the duplicate carries no
   * new information.
   */
  async enqueue(entries: OutboxEntry[], db: Db = prisma): Promise<number> {
    if (entries.length === 0) return 0;
    const result = await db.emailOutbox.createMany({
      data: entries.map((e) => ({
        ticketId: e.ticketId,
        eventType: e.eventType,
        sourceRecordId: e.sourceRecordId,
        recipientUserId: e.recipientUserId,
        recipientEmail: e.recipientEmail,
        lang: e.lang,
        payload: e.payload as unknown as Prisma.InputJsonValue,
        ...(e.suppressedReason
          ? { status: "suppressed" as const, suppressedReason: e.suppressedReason }
          : {}),
      })),
      skipDuplicates: true,
    });
    return result.count;
  },

  /**
   * Take up to `limit` rows that are due, and lease them.
   *
   * Raw SQL because Prisma has no `FOR UPDATE SKIP LOCKED`, and without it the
   * sweep is not safe to run twice at once — every API instance runs its own
   * `setInterval`, so two of them would read the same pending rows and mail them
   * both. `SKIP LOCKED` makes the losers step over the locked rows rather than
   * queue behind them.
   *
   * The claim does two things in the same statement:
   *
   *   - `attempts + 1` counts the try at the moment it STARTS. A process that
   *     dies mid-send has still used an attempt; counting on success instead
   *     would let a send that reliably crashes retry for ever.
   *   - `next_attempt_at` moves out by a lease, so a row whose worker vanishes
   *     silently becomes eligible again later instead of being stuck forever.
   */
  async claimDue(
    limit: number,
    leaseMs: number,
    now: Date = new Date(),
  ): Promise<ClaimedEmail[]> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const rows = await prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "email_outbox"
         SET "attempts" = "attempts" + 1,
             "next_attempt_at" = ${leaseUntil},
             "updated_at" = ${now}
       WHERE "id" IN (
         SELECT "id" FROM "email_outbox"
          WHERE "status" = 'pending'
            AND "next_attempt_at" <= ${now}
          ORDER BY "id" ASC
          LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING "id", "ticket_id", "event_type", "recipient_user_id",
                "recipient_email", "lang", "payload", "attempts"
    `);
    return rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      eventType: r.event_type as EmailEvent,
      recipientUserId: r.recipient_user_id,
      recipientEmail: r.recipient_email,
      lang: r.lang as Lang,
      payload: r.payload as EmailPayload,
      attempts: r.attempts,
    }));
  },

  async markSent(id: number, messageId: string | undefined, at: Date): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: "sent", sentAt: at, messageId: messageId ?? null, error: null },
    });
  },

  /** Put a failed row back in the queue with its backoff applied. */
  async reschedule(id: number, nextAttemptAt: Date, error: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: "pending", nextAttemptAt, error: truncateError(error) },
    });
  },

  /** Out of attempts. Terminal — the Activity log is where this surfaces. */
  async markFailed(id: number, error: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: "failed", error: truncateError(error) },
    });
  },

  /** Decided against rather than attempted. */
  async markSuppressed(id: number, reason: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: "suppressed", suppressedReason: reason },
    });
  },

  /**
   * The threading anchors for the next mail in a (ticket, recipient)
   * conversation: the root message and the most recent one.
   *
   * Per RECIPIENT, not per ticket. A ticket's mail goes to several people and
   * they each receive a different subset — chaining one person's mail onto a
   * message they were never sent gives their client a dangling reference, and
   * (worse) tells them a message they cannot see exists.
   */
  async threadAnchors(
    ticketId: number,
    recipientUserId: number,
  ): Promise<{ root?: string; last?: string }> {
    const rows = await prisma.emailOutbox.findMany({
      where: {
        ticketId,
        recipientUserId,
        status: "sent",
        messageId: { not: null },
      },
      orderBy: { id: "asc" },
      select: { messageId: true },
    });
    const ids = rows.map((r) => r.messageId).filter((m): m is string => m != null);
    if (ids.length === 0) return {};
    return { root: ids[0], last: ids[ids.length - 1] };
  },

  /**
   * How many mails already went to this person about this ticket inside the
   * window — the input to the per-ticket rate limit.
   */
  async countSentSince(
    ticketId: number,
    recipientUserId: number,
    since: Date,
    eventType?: EmailEvent,
  ): Promise<number> {
    return prisma.emailOutbox.count({
      where: {
        ticketId,
        recipientUserId,
        status: "sent",
        sentAt: { gte: since },
        ...(eventType ? { eventType } : {}),
      },
    });
  },

  /**
   * Pending rows for the same (ticket, recipient), oldest first — what a
   * collapse folds together into one summary.
   */
  async pendingFor(
    ticketId: number,
    recipientUserId: number,
    excludeId: number,
  ): Promise<number[]> {
    const rows = await prisma.emailOutbox.findMany({
      where: {
        ticketId,
        recipientUserId,
        status: "pending",
        id: { not: excludeId },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /** Fold a set of rows away as covered by a summary that was sent instead. */
  async markCollapsed(ids: number[], intoId: number): Promise<void> {
    if (ids.length === 0) return;
    await prisma.emailOutbox.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "suppressed",
        suppressedReason: `collapsed_into_email_${intoId}`,
      },
    });
  },
};

/** Keep a provider's stack trace from becoming the biggest column in the table. */
function truncateError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 499)}…` : message;
}
