import { prisma } from "../../../shared/db";
import { auditRepository } from "../../audit/audit.repository";
import type { ThreadSender, ThreadTarget } from "./email.thread";

export const emailRepository = {
  /**
   * Find the comment a provider retry refers to. `messageId` is unique, so a
   * hit means this exact message was already filed and must not be duplicated.
   */
  async findCommentByMessageId(
    messageId: string,
  ): Promise<{ id: number; ticketId: number } | null> {
    const row = await prisma.comment.findUnique({
      where: { messageId },
      select: { id: true, ticketId: true },
    });
    return row ?? null;
  },

  /**
   * Resolve the ticket an email belongs to from its ancestor Message-IDs.
   * Candidates arrive newest-first; the first stored ancestor wins, so a reply
   * deep in a chain still lands on the right ticket.
   */
  async findTicketIdByAncestors(
    messageIds: string[],
  ): Promise<number | null> {
    for (const messageId of messageIds) {
      const row = await prisma.comment.findUnique({
        where: { messageId },
        select: { ticketId: true },
      });
      if (row) return row.ticketId;
    }
    return null;
  },

  /** The sender's role + tenant, for the threading authorization rule. */
  async findSender(userId: number): Promise<ThreadSender | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, customerId: true },
    });
    return row ?? null;
  },

  /** The target ticket's participants + tenant, for the same rule. */
  async findThreadTarget(ticketId: number): Promise<ThreadTarget | null> {
    const row = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        requesterId: true,
        assigneeId: true,
        customerId: true,
        affectedUsers: { select: { userId: true } },
      },
    });
    if (!row) return null;
    return {
      requesterId: row.requesterId,
      assigneeId: row.assigneeId,
      customerId: row.customerId,
      affectedUserIds: row.affectedUsers.map((a) => a.userId),
    };
  },

  /**
   * Resolve the category new email tickets should land in: the preferred name
   * (case-insensitive) if it exists, else the first category by id. Null only
   * if the instance has no categories at all.
   */
  async resolveCategoryId(preferredName?: string): Promise<number | null> {
    if (preferredName) {
      const byName = await prisma.category.findFirst({
        where: { name: { equals: preferredName.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    const first = await prisma.category.findFirst({
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return first?.id ?? null;
  },

  /**
   * Find a user by email, or create a `requester` for an unknown sender. The
   * created user has no password (they never sign in — they only correspond by
   * email), matching the nullable password_hash column.
   */
  async findOrCreateRequester(
    email: string,
    name: string | undefined,
  ): Promise<{ id: number; created: boolean }> {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await prisma.user.create({
      data: {
        name: name?.trim() || email.split("@")[0],
        email: email.toLowerCase(),
        role: "requester",
        passwordHash: null,
      },
      select: { id: true },
    });
    await auditRepository.record({
      userId: null,
      action: "user.create",
      entity: "user",
      entityId: created.id,
      meta: { via: "email", email },
    });
    return { id: created.id, created: true };
  },
};
