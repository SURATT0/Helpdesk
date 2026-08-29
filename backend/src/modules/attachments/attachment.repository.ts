import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { isRenderableImage } from "./attachment.sniff";

const attachmentInclude = {
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.AttachmentInclude;

type AttachmentRow = Prisma.AttachmentGetPayload<{
  include: typeof attachmentInclude;
}>;

export type AttachmentDto = {
  id: number;
  /**
   * The name to show. Falls back to the uploader's own name for any row the
   * backfill has not reached, so nothing ever renders blank.
   */
  displayName: string;
  /** The uploader's original name, for the hover tooltip. */
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** The message this file was sent with, or null for a ticket-level file. */
  commentId: number | null;
  /**
   * Whether the thread may draw this inline. Decided here, from the stored type,
   * so the client never has to keep its own list of renderable formats — and so
   * a stored SVG is a download card on every surface at once.
   */
  isImage: boolean;
  /** Intrinsic size of the original, for the reserved box. Null if unknown. */
  width: number | null;
  height: number | null;
  /** Whether a resized copy exists; the thread requests /thumb either way. */
  hasThumbnail: boolean;
  createdAt: string;
  uploader: { id: number; name: string };
};

/**
 * Exported so the comment repository can shape the files it includes with a
 * message. One mapper: `isImage`, the displayName fallback and the thumbnail
 * flag are decided in exactly one place, whichever surface asks for the file.
 */
export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    displayName: row.displayName ?? row.filename,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    commentId: row.commentId,
    isImage: isRenderableImage(row.contentType),
    width: row.width,
    height: row.height,
    hasThumbnail: row.thumbKey != null,
    createdAt: row.createdAt.toISOString(),
    uploader: row.uploader,
  };
}

export const attachmentRepository = {
  async findByTicket(ticketId: number): Promise<AttachmentDto[]> {
    const rows = await prisma.attachment.findMany({
      where: { ticketId },
      include: attachmentInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toAttachmentDto);
  },

  findById(id: number) {
    return prisma.attachment.findUnique({ where: { id } });
  },

  /** How many files a ticket already holds — the basis of the next sequence. */
  countByTicket(ticketId: number): Promise<number> {
    return prisma.attachment.count({ where: { ticketId } });
  },

  /** Hard-delete an attachment row (attachments have no soft-delete column). */
  async remove(
    id: number,
    actorId: number,
    meta: { ticketId: number; filename: string },
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id } });
      await auditRepository.record(
        {
          userId: actorId,
          action: "attachment.delete",
          entity: "attachment",
          entityId: id,
          meta,
        },
        tx,
      );
    });
  },

  async create(data: {
    ticketId: number;
    commentId?: number | null;
    uploaderId: number;
    filename: string;
    displayName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    thumbKey?: string | null;
    width?: number | null;
    height?: number | null;
  }): Promise<AttachmentDto> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data,
        include: attachmentInclude,
      });
      await auditRepository.record(
        {
          userId: data.uploaderId,
          action: "attachment.create",
          entity: "attachment",
          entityId: created.id,
          // Both names, deliberately: the trail should say what the uploader
          // called it AND what the system named it, or a later reader cannot
          // match an audit row to a file they can see.
          meta: {
            ticketId: data.ticketId,
            filename: data.filename,
            displayName: data.displayName,
            commentId: data.commentId ?? null,
          },
        },
        tx,
      );
      return toAttachmentDto(created);
    });
  },
};
