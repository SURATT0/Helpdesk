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

/**
 * Tell these people's bells to refetch.
 *
 * Call it AFTER the transaction that wrote the notifications has committed —
 * see `createMany`. Separated from the write for exactly that reason: the two
 * have to happen at different moments, and a function that did both could only
 * ever do them at the same one.
 */
export function notifyBell(userIds: readonly number[]): void {
  for (const userId of userIds) bus.emit("notification.created", { userId });
}

export const notificationRepository = {
  /**
   * Bulk-create notifications; call with a tx client to commit atomically.
   *
   * Returns the recipients so a transactional caller can ring their bells AFTER
   * committing, via `notifyBell`. The signal carries no data — it only tells a
   * client to refetch — which is exactly why it must not be sent early: a
   * refetch that arrives before the commit reads the old count, and since no
   * second signal follows, the bell then sits on a stale number until the slow
   * poll catches up. That is not theoretical. It happened the moment this
   * repository stopped being the last write in the comment transaction.
   *
   * Emitting here when we own the write (no tx passed) is still correct: the
   * `createMany` above has committed by the time we reach this line.
   */
  async createMany(
    entries: NotificationEntry[],
    db: Db = prisma,
  ): Promise<{ count: number; notified: number[] }> {
    if (entries.length === 0) return { count: 0, notified: [] };
    const result = await db.notification.createMany({
      data: entries.map((e) => ({
        userId: e.userId,
        type: e.type,
        ticketId: e.ticketId ?? null,
        message: e.message,
      })),
    });
    const notified = [...new Set(entries.map((e) => e.userId))];
    if (db === prisma) notifyBell(notified);
    return { count: result.count, notified };
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
