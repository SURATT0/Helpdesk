import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BadRequest, NotFound } from "../../shared/errors";
import type { AuthUser } from "../../shared/auth";
import { logger } from "../../shared/logger";
import { storage } from "../../shared/storage";
import { prisma } from "../../shared/db";
import { ticketService } from "../tickets/ticket.service";
import { attachmentRepository, type AttachmentDto } from "./attachment.repository";
import { processImage } from "./attachment.image";
import { buildDisplayName, storageKeyFor, thumbKeyFor } from "./attachment.naming";
import { verifyUpload, RENDERABLE_MIMES } from "./attachment.sniff";

export type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/**
 * Types the API accepts. The single source for it — the multer filter reads this
 * too, so the door and the verifier cannot disagree about what is allowed.
 *
 * SVG is absent on purpose: an SVG is a document that can carry script, so an
 * inline one is an XSS vector. Anything not on this list is refused at upload,
 * and a row that predates the list is served as a download card.
 */
export const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  ...RENDERABLE_MIMES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** How many times to retry a display-name collision before giving up. */
const NAME_RETRIES = 5;

export const attachmentService = {
  async list(ticketId: number, user: AuthUser): Promise<AttachmentDto[]> {
    await ticketService.get(ticketId, user); // authorize via ticket scope
    return attachmentRepository.findByTicket(ticketId);
  },

  /**
   * Store a file against a ticket, and optionally against the message it was
   * sent with.
   *
   * The order matters. The bytes are identified BEFORE anything is written,
   * because the verified type decides both the extension in the storage key and
   * the type the file will later be served with — deriving either from what the
   * client claimed is how a renamed executable ends up inside an `<img>` tag.
   */
  async upload(
    ticketId: number,
    file: UploadedFile,
    user: AuthUser,
    commentId?: number,
  ): Promise<AttachmentDto> {
    await ticketService.get(ticketId, user);

    // A message id is only meaningful on its own ticket. Checked here rather
    // than trusted, so a caller cannot hang a file off someone else's thread.
    if (commentId != null) {
      const comment = await prisma.comment.findFirst({
        where: { id: commentId, ticketId, deletedAt: null },
        select: { id: true },
      });
      if (!comment) throw BadRequest(`Unknown message #${commentId} on this ticket`);
    }

    const verified = verifyUpload({
      buffer: file.buffer,
      declaredType: file.mimetype,
      allowed: ALLOWED_TYPES,
    });
    if (!verified.ok) throw BadRequest(verified.reason);

    const key = storageKeyFor(verified.ext, randomBytes(16).toString("hex"));
    await storage.save(key, file.buffer);

    // Images get measured and, if large, shrunk. Both are optional results:
    // `processImage` never throws, so a corrupt image still becomes a row.
    let width: number | null = null;
    let height: number | null = null;
    let thumbKey: string | null = null;
    if (RENDERABLE_MIMES.has(verified.mime)) {
      const facts = await processImage(file.buffer);
      width = facts.width;
      height = facts.height;
      if (facts.thumbnail) {
        const tKey = thumbKeyFor(key);
        try {
          await storage.save(tKey, facts.thumbnail);
          thumbKey = tKey;
        } catch (cause) {
          // The original is already stored; a missing thumbnail costs bandwidth,
          // not correctness, and /thumb falls back to the full file.
          logger.warn({ err: cause }, "attachment: could not store thumbnail");
        }
      }
    }

    // The sequence comes from the ticket's current count, and two uploads racing
    // can read the same one. The unique index on (ticketId, displayName) is what
    // settles it: the loser lands here again with the next number.
    let sequence = (await attachmentRepository.countByTicket(ticketId)) + 1;
    for (let attempt = 0; ; attempt++) {
      try {
        return await attachmentRepository.create({
          ticketId,
          commentId: commentId ?? null,
          uploaderId: user.id,
          filename: file.originalname,
          displayName: buildDisplayName({
            ticketId,
            sequence,
            originalName: file.originalname,
            ext: verified.ext,
          }),
          contentType: verified.mime,
          sizeBytes: file.size,
          storageKey: key,
          thumbKey,
          width,
          height,
        });
      } catch (cause) {
        const collided =
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === "P2002";
        if (!collided || attempt >= NAME_RETRIES) throw cause;
        sequence += 1;
      }
    }
  },

  /**
   * The stored bytes, for download or for an `<img>`.
   *
   * `variant: "thumb"` serves the resized copy, falling back to the original —
   * so the client can always ask for a thumbnail and never has to branch on
   * whether one was produced.
   */
  async read(
    id: number,
    user: AuthUser,
    variant: "full" | "thumb" = "full",
  ): Promise<{
    displayName: string;
    contentType: string;
    data: Buffer;
    isImage: boolean;
  }> {
    const att = await attachmentRepository.findById(id);
    if (!att) throw NotFound("Attachment not found");
    // Row scope via the parent ticket: its requester, or staff inside the same
    // customer. Anyone else gets a 404 from here, never the bytes.
    await ticketService.get(att.ticketId, user);

    const wantThumb = variant === "thumb" && att.thumbKey != null;
    let data: Buffer;
    try {
      data = await storage.read(wantThumb ? att.thumbKey! : att.storageKey);
    } catch {
      if (wantThumb) {
        // The thumbnail is a derived convenience — if it went missing, the
        // original may still be there, and a reader should get the picture.
        try {
          data = await storage.read(att.storageKey);
        } catch {
          throw NotFound("Attachment file is no longer available in storage");
        }
      } else {
        // The DB row exists but the bytes are gone (never persisted, pruned, or
        // on a different volume). A clean 404 lets the client say the file is
        // unavailable rather than "download failed" with no reason — and lets
        // the thread draw a placeholder instead of a broken image.
        throw NotFound("Attachment file is no longer available in storage");
      }
    }
    return {
      displayName: att.displayName ?? att.filename,
      contentType: att.contentType,
      data,
      isImage: RENDERABLE_MIMES.has(att.contentType),
    };
  },

  async remove(id: number, user: AuthUser): Promise<void> {
    const att = await attachmentRepository.findById(id);
    if (!att) throw NotFound("Attachment not found");
    await ticketService.get(att.ticketId, user); // row scope → 404 if out of scope
    // Best-effort storage cleanup (idempotent for already-missing files), then
    // remove the DB row + audit. A storage hiccup shouldn't block delisting.
    for (const key of [att.storageKey, att.thumbKey]) {
      if (!key) continue;
      try {
        await storage.delete(key);
      } catch {
        /* orphaned/unreachable file — still remove the record */
      }
    }
    await attachmentRepository.remove(id, user.id, {
      ticketId: att.ticketId,
      filename: att.filename,
    });
  },
};
