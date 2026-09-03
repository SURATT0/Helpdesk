import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import { prisma } from "../../shared/db";
import {
  toAttachmentDto,
  type AttachmentDto,
} from "../attachments/attachment.repository";
import { auditRepository } from "../audit/audit.repository";
import {
  notificationRepository,
  notifyBell,
} from "../notifications/notification.repository";
import { loadTicketEmailContext } from "../emails/email.context";
import { emailOutboxService } from "../emails/email-outbox.service";
import type { EmailEvent } from "../emails/email.events";

const commentInclude = {
  author: { select: { id: true, name: true, role: true } },
  // Files sent WITH this message, so the thread can draw them in the bubble.
  // Ordered by id: the sequence in a display name follows upload order, and the
  // grid should read the same way.
  attachments: {
    include: { uploader: { select: { id: true, name: true } } },
    orderBy: { id: "asc" as const },
  },
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
  /**
   * Files sent with this message. Empty for a message with none, and for every
   * file attached to the ticket without a message — those live in the sidebar.
   */
  attachments: AttachmentDto[];
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
    attachments: row.attachments.map(toAttachmentDto),
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
    /**
     * Deliver the requester's mail for this comment to THIS address instead of
     * the one on their account.
     *
     * The agent reply composer has an editable To: field, and honouring it is
     * the whole point of that field — a requester who says "copy my manager" is
     * answered at the address they asked for. It overrides the ADDRESS only:
     * who the recipient is, what audience they are, and which language they read
     * are all still decided by the recipient rules, so this cannot turn a
     * staff-only event into one that goes outward.
     */
    emailDeliverTo?: string;
  }): Promise<CommentDto> {
    // The bells are rung after the commit, not inside it — a refetch triggered
    // while the transaction is still open reads the count from before it, and
    // nothing sends a second signal to correct that. See `notifyBell`.
    const { dto, notified } = await prisma.$transaction(async (tx) => {
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
      let notified: number[] = [];
      if (ticket) {
        const recipients = [ticket.requesterId, ticket.assigneeId].filter(
          (x): x is number =>
            x != null &&
            x !== data.authorId &&
            !(data.internal && x === ticket.requesterId),
        );
        ({ notified } = await notificationRepository.createMany(
          [...new Set(recipients)].map((userId) => ({
            userId,
            type: "ticket.comment",
            ticketId: data.ticketId,
            message: `New ${data.internal ? "internal note" : "reply"} on ticket #${data.ticketId}`,
          })),
          tx,
        ));

        // Queue the email for the same event, in this same transaction — the
        // bell entry and the mail are written together or not at all.
        //
        // Which event it is depends on WHO wrote and whether it was a note, and
        // the three answers have three different audiences. Deciding it here,
        // where the author and the ticket are both in hand, is what lets the
        // mail layer resolve recipients without re-deriving any of it:
        //
        //   internal note        → the desk (assignee, or the queue behind them)
        //   staff wrote publicly → the requester
        //   requester wrote      → the desk, and specifically the QUEUE when
        //                          nobody owns the ticket, which is the case
        //                          that used to go unnoticed for weeks
        const authorIsRequester = data.authorId === ticket.requesterId;
        const event: EmailEvent = data.internal
          ? "comment.internal_note"
          : authorIsRequester
            ? ticket.assigneeId == null
              ? "queue.requester_replied"
              : "comment.requester_replied"
            : "comment.public_reply";

        const emailCtx = await loadTicketEmailContext(data.ticketId, tx);
        if (emailCtx) {
          await emailOutboxService.queue(
            {
              event,
              ctx: { ...emailCtx.ctx, actorId: data.authorId },
              // The comment, not the ticket: one mail per message. Keying this
              // on the ticket would mail the first comment and silently drop
              // every reply after it as a duplicate.
              sourceRecordId: created.id,
              ticket: emailCtx.summary,
              occurredAt: created.createdAt,
              message: {
                authorName: created.author.name,
                body: created.body,
              },
              vars: { author: created.author.name },
              problem: emailCtx.problem,
              deliverTo: data.emailDeliverTo,
            },
            tx,
          );
        }
      }

      return { dto: toDto(created), notified };
    });
    notifyBell(notified);
    return dto;
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
