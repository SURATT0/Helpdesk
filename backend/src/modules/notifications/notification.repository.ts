import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { bus } from "../../shared/events";

type Db = Prisma.TransactionClient | typeof prisma;

export type NotificationEntry = {
  userId: number;
  type: string;
  ticketId?: number | null;
  message: string;
};

export type NotificationDto = {
  id: number;
  type: string;
  ticketId: number | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: number;
  type: string;
  ticketId: number | null;
  message: string;
  readAt: Date | null;
  createdAt: Date;
};

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    ticketId: row.ticketId,
    message: row.message,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const notificationRepository = {
  /**
   * Bulk-create notifications; call with a tx client to commit atomically. After
   * the write, fans out a `notification.created` signal per distinct recipient so
   * their bell can refetch live (SSE) instead of polling. The signal only tells
   * the client to refetch — it carries no data — so an over-eager fire (e.g. a
   * later rollback in the same tx) just triggers a harmless no-op refetch.
   */
  async createMany(entries: NotificationEntry[], db: Db = prisma) {
    if (entries.length === 0) return { count: 0 };
    const result = await db.notification.createMany({
      data: entries.map((e) => ({
        userId: e.userId,
        type: e.type,
        ticketId: e.ticketId ?? null,
        message: e.message,
      })),
    });
    for (const userId of new Set(entries.map((e) => e.userId))) {
      bus.emit("notification.created", { userId });
    }
    return result;
  },

  async listForUser(userId: number, limit = 20): Promise<NotificationDto[]> {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toDto);
  },

  unreadCount(userId: number): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  async markRead(id: number, userId: number): Promise<void> {
    // Scoped to the owner so one user can't mark another's notification.
    await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  },

  async markAllRead(userId: number): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};
