import { randomUUID } from "node:crypto";
import path from "node:path";
import { NotFound } from "../../shared/errors";
import type { AuthUser } from "../../shared/auth";
import { storage } from "../../shared/storage";
import { ticketService } from "../tickets/ticket.service";
import { attachmentRepository, type AttachmentDto } from "./attachment.repository";

export type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export const attachmentService = {
  async list(ticketId: number, user: AuthUser): Promise<AttachmentDto[]> {
    await ticketService.get(ticketId, user); // authorize via ticket scope
    return attachmentRepository.findByTicket(ticketId);
  },

  async upload(
    ticketId: number,
    file: UploadedFile,
    user: AuthUser,
  ): Promise<AttachmentDto> {
    await ticketService.get(ticketId, user);
    const key = `tickets/${ticketId}/${randomUUID()}${path.extname(file.originalname)}`;
    await storage.save(key, file.buffer);
    return attachmentRepository.create({
      ticketId,
      uploaderId: user.id,
      filename: file.originalname,
      contentType: file.mimetype,
      sizeBytes: file.size,
      storageKey: key,
    });
  },

  async download(
    id: number,
    user: AuthUser,
  ): Promise<{ filename: string; contentType: string; data: Buffer }> {
    const att = await attachmentRepository.findById(id);
    if (!att) throw NotFound("Attachment not found");
    await ticketService.get(att.ticketId, user); // scope via the parent ticket
    let data: Buffer;
    try {
      data = await storage.read(att.storageKey);
    } catch {
      // The DB row exists but the bytes are gone (never persisted, pruned, or on
      // a different volume). Surface a clean 404 instead of a 500 crash so the
      // client can tell the user the file is unavailable rather than "download
      // failed" with no reason.
      throw NotFound("Attachment file is no longer available in storage");
    }
    return { filename: att.filename, contentType: att.contentType, data };
  },

  async remove(id: number, user: AuthUser): Promise<void> {
    const att = await attachmentRepository.findById(id);
    if (!att) throw NotFound("Attachment not found");
    await ticketService.get(att.ticketId, user); // row scope → 404 if out of scope
    // Best-effort storage cleanup (idempotent for already-missing files), then
    // remove the DB row + audit. A storage hiccup shouldn't block delisting.
    try {
      await storage.delete(att.storageKey);
    } catch {
      /* orphaned/unreachable file — still remove the record */
    }
    await attachmentRepository.remove(id, user.id, {
      ticketId: att.ticketId,
      filename: att.filename,
    });
  },
};
