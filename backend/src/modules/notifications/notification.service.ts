import type { AuthUser } from "../../shared/auth";
import {
  notificationRepository,
  type NotificationDto,
} from "./notification.repository";

/**
 * The in-app bell, and only that.
 *
 * Notifications used to deliver email too, by way of an `emailed_at` column read
 * as an outbox. That job moved to `modules/emails`, which needs things a bell
 * entry does not have — a per-recipient language, retry state, an RFC 5322
 * identity and a threading chain — and keeping both would have meant two systems
 * delivering the same event. The column remains on the table; nothing reads it.
 */
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
};
