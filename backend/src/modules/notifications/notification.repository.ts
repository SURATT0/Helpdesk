import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";

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
  /** Bulk-create notifications; call with a tx client to commit atomically. */
  createMany(entries: NotificationEntry[], db: Db = prisma) {
    if (entries.length === 0) return Promise.resolve({ count: 0 });
    return db.notification.createMany({
      data: entries.map((e) => ({
        userId: e.userId,
        type: e.type,
        ticketId: e.ticketId ?? null,
        message: e.message,
      })),
    });
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
