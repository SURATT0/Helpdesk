import type { AuthUser } from "../../shared/auth";
import {
  notificationRepository,
  type NotificationDto,
} from "./notification.repository";

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
