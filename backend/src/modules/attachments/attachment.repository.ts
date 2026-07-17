import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";

const attachmentInclude = {
  uploader: { select: { id: true, name: true } },
} satisfies Prisma.AttachmentInclude;

type AttachmentRow = Prisma.AttachmentGetPayload<{
  include: typeof attachmentInclude;
}>;

export type AttachmentDto = {
  id: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploader: { id: number; name: string };
};

function toDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
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
    return rows.map(toDto);
  },

  findById(id: number) {
    return prisma.attachment.findUnique({ where: { id } });
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
    uploaderId: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
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
          meta: { ticketId: data.ticketId, filename: data.filename },
        },
        tx,
      );
      return toDto(created);
    });
  },
};
