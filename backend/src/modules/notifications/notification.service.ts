import type { AuthUser } from "../../shared/auth";
import { logger } from "../../shared/logger";
import { notificationMailer } from "./notification.mailer";
import {
  notificationRepository,
  type NotificationDto,
} from "./notification.repository";

/** Rows handled per sweep pass — bounds one tick's work and mail volume. */
const EMAIL_BATCH_LIMIT = 100;

/**
 * How far back the sweep will still mail. Older un-emailed rows are stale news;
 * they get stamped without sending so a long disable-then-enable gap can't
 * trigger a flood.
 */
const EMAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const notificationService = {
  async list(
    user: AuthUser,
  ): Promise<{ items: NotificationDto[]; unread: number }> {
    const [items, unread] = await Promise.all([
      notificationRepository.listForUser(user.id),
      notificationRepository.unreadCount(user.id),
    ]);
    return { items, unread };
  },

  markRead(id: number, user: AuthUser): Promise<void> {
    return notificationRepository.markRead(id, user.id);
  },

  markAllRead(user: AuthUser): Promise<void> {
    return notificationRepository.markAllRead(user.id);
  },

  /**
   * Mail the notifications that haven't been emailed yet.
   *
   * Notifications were in-app only: `mailSender` was reached from exactly one
   * place, an agent's manual reply. This is the delivery half.
   *
   * Built as a sweep over the notifications table rather than a send inside each
   * mutation, because those writes all happen inside transactions — mailing from
   * there would send for work that later rolls back, and would put network I/O on
   * the critical path of every comment and status change. Reading the table as an
   * outbox gets commit-safety and free retries, and every notification type is
   * covered without touching a single call site.
   *
   * Per-row failures are isolated: one bad address doesn't stall the batch, and
   * the row stays pending for the next pass.
   */
  async sweepEmail(
    now: Date = new Date(),
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    const notBefore = new Date(now.getTime() - EMAIL_MAX_AGE_MS);

    // Retire anything too old to be worth sending, so it stops being scanned.
    const stale = await notificationRepository.findStalePendingEmailIds(
      notBefore,
      EMAIL_BATCH_LIMIT,
    );
    if (stale.length > 0) {
      await notificationRepository.markEmailed(stale, now);
      logger.info(
        { count: stale.length },
        "skipped stale notification emails (older than the max age)",
      );
    }

    const pending = await notificationRepository.findPendingEmail(
      EMAIL_BATCH_LIMIT,
      notBefore,
    );
    if (pending.length === 0) return { sent: 0, skipped: 0, failed: 0 };

    const handled: number[] = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const n of pending) {
      try {
        const outcome = await notificationMailer.deliver(n);
        // Both outcomes are final decisions, so both get stamped. Only a thrown
        // error leaves the row pending.
        handled.push(n.id);
        if (outcome === "sent") sent++;
        else skipped++;
      } catch (err) {
        failed++;
        logger.warn(
          { err, notificationId: n.id, type: n.type },
          "notification email failed; leaving it pending for the next sweep",
        );
      }
    }

    await notificationRepository.markEmailed(handled, now);
    return { sent, skipped, failed };
  },
};
