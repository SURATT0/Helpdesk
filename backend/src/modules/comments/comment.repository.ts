import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { notificationRepository } from "../notifications/notification.repository";

const commentInclude = {
  author: { select: { id: true, name: true, role: true } },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

export type CommentDto = {
  id: number;
  body: string;
  internal: boolean;
  /**
   * Which channel the message arrived on. Web and email replies live in ONE
   * ordered thread — this is a badge for the UI, never a filter: `findByTicket`
   * returns both without distinction.
   */
  channel: "web" | "email";
  createdAt: string;
  author: { id: number; name: string; role: Role };
};

/** A participant's read pointer for a ticket's chat. */
export type ReadMarker = {
  userId: number;
  name: string;
  lastReadCommentId: number;
};

function toDto(row: CommentRow): CommentDto {
  return {
    id: row.id,
    body: row.body,
    internal: row.internal,
    channel: row.channel,
    createdAt: row.createdAt.toISOString(),
    author: row.author,
  };
}

export const commentRepository = {
  async findByTicket(
    ticketId: number,
    includeInternal: boolean,
  ): Promise<CommentDto[]> {
    const rows = await prisma.comment.findMany({
      where: {
        ticketId,
        deletedAt: null,
        ...(includeInternal ? {} : { internal: false }),
      },
      include: commentInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDto);
  },

  findById(id: number) {
    return prisma.comment.findUnique({ where: { id } });
  },

  /**
   * Look a comment up by the mail it came from. Inbound webhooks are retried by
   * every provider, so ingest uses this to stay idempotent.
   */
  findByMessageId(messageId: string) {
    return prisma.comment.findUnique({
      where: { messageId },
      select: { id: true, ticketId: true },
    });
  },

  /**
   * Attach the Message-ID of a mail we just sent to its comment. Recorded after
   * dispatch because the id is minted by the transport.
   */
  async setMessageId(id: number, messageId: string): Promise<void> {
    // A colliding id would mean the transport reused one — keep the first.
    const clash = await prisma.comment.findUnique({
      where: { messageId },
      select: { id: true },
    });
    if (clash && clash.id !== id) return;
    await prisma.comment.update({ where: { id }, data: { messageId } });
  },

  async create(data: {
    ticketId: number;
    authorId: number;
    body: string;
    internal: boolean;
    /** Defaults to `web`; the email ingest path passes `email`. */
    channel?: "web" | "email";
    /** RFC 5322 Message-ID, when this comment corresponds to a real mail. */
    messageId?: string | null;
  }): Promise<CommentDto> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          ticketId: data.ticketId,
          authorId: data.authorId,
          body: data.body,
          internal: data.internal,
          channel: data.channel ?? "web",
          messageId: data.messageId ?? null,
        },
        include: commentInclude,
      });
      await auditRepository.record(
        {
          userId: data.authorId,
          action: "comment.create",
          entity: "comment",
          entityId: created.id,
          meta: {
            ticketId: data.ticketId,
            internal: data.internal,
            channel: data.channel ?? "web",
          },
        },
        tx,
      );

      // Notify the requester + assignee (minus the author). Internal notes are
      // never surfaced to the requester.
      const ticket = await tx.ticket.findUnique({
        where: { id: data.ticketId },
        select: { requesterId: true, assigneeId: true },
      });
      if (ticket) {
        const recipients = [ticket.requesterId, ticket.assigneeId].filter(
          (x): x is number =>
            x != null &&
            x !== data.authorId &&
            !(data.internal && x === ticket.requesterId),
        );
        await notificationRepository.createMany(
          [...new Set(recipients)].map((userId) => ({
            userId,
            type: "ticket.comment",
            ticketId: data.ticketId,
            message: `New ${data.internal ? "internal note" : "reply"} on ticket #${data.ticketId}`,
          })),
          tx,
        );
      }

      return toDto(created);
    });
  },

  /** Advance a user's read pointer for a ticket (never moves backwards). */
  async markRead(
    ticketId: number,
    userId: number,
    commentId: number,
  ): Promise<number> {
    const existing = await prisma.ticketRead.findUnique({
      where: { ticketId_userId: { ticketId, userId } },
    });
    const lastReadCommentId = Math.max(
      existing?.lastReadCommentId ?? 0,
      commentId,
    );
    await prisma.ticketRead.upsert({
      where: { ticketId_userId: { ticketId, userId } },
      create: { ticketId, userId, lastReadCommentId },
      update: { lastReadCommentId },
    });
    return lastReadCommentId;
  },

  /** Every participant's read pointer for a ticket (for read receipts). */
  async findReads(ticketId: number): Promise<ReadMarker[]> {
    const rows = await prisma.ticketRead.findMany({
      where: { ticketId },
      include: { user: { select: { name: true } } },
    });
    return rows.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      lastReadCommentId: r.lastReadCommentId,
    }));
  },

  async softDelete(id: number, userId: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id }, data: { deletedAt: new Date() } });
      await auditRepository.record(
        { userId, action: "comment.delete", entity: "comment", entityId: id },
        tx,
      );
    });
  },
};
