import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { bus } from "../../shared/events";
import type { PendingNotification } from "./notification.mailer";

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

  /**
   * Which `(ticketId, userId, type)` combinations already exist, as a set of
   * `"<ticketId>:<userId>:<type>"` keys.
   *
   * This is the idempotency guard for the recurring SLA sweep, which re-examines
   * the same at-risk tickets every time it runs and must not re-notify. Done as a
   * lookup rather than a unique index because the dedupe is per alert TYPE, not
   * per ticket: a ticket that was warned and later breaches should still produce
   * the breach alert, and a reassignment should still notify the new assignee.
   */
  async findExistingKeys(
    types: readonly string[],
    ticketIds: readonly number[],
  ): Promise<Set<string>> {
    if (ticketIds.length === 0 || types.length === 0) return new Set();
    const rows = await prisma.notification.findMany({
      where: { type: { in: [...types] }, ticketId: { in: [...ticketIds] } },
      select: { ticketId: true, userId: true, type: true },
    });
    return new Set(rows.map((r) => `${r.ticketId}:${r.userId}:${r.type}`));
  },

  /**
   * Notifications awaiting email delivery, oldest first, joined to the recipient.
   *
   * `createdAt >= notBefore` is a safety valve independent of the migration's
   * backfill: if the sweep is disabled for a long stretch and then re-enabled, an
   * old backlog is stale news and mailing it would be worse than dropping it. The
   * caller stamps whatever it skips so nothing loops forever.
   */
  async findPendingEmail(
    limit: number,
    notBefore: Date,
  ): Promise<PendingNotification[]> {
    const rows = await prisma.notification.findMany({
      where: { emailedAt: null, createdAt: { gte: notBefore } },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        type: true,
        ticketId: true,
        message: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      ticketId: r.ticketId,
      message: r.message,
      recipient: r.user,
    }));
  },

  /** Ids of un-emailed rows older than the cutoff — stamped without sending. */
  async findStalePendingEmailIds(
    notBefore: Date,
    limit: number,
  ): Promise<number[]> {
    const rows = await prisma.notification.findMany({
      where: { emailedAt: null, createdAt: { lt: notBefore } },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /** Stamp rows as handled, whether they were sent or deliberately skipped. */
  async markEmailed(ids: number[], at: Date = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: { emailedAt: at },
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
