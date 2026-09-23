import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env";
import { logger } from "../../shared/logger";
import { storage } from "../../shared/storage";
import { prisma } from "../../shared/db";
import { ALLOWED_TYPES, type UploadedFile } from "../attachments/attachment.service";
import { attachmentRepository, type AttachmentDto } from "../attachments/attachment.repository";
import { processImage } from "../attachments/attachment.image";
import {
  buildDisplayName,
  storageKeyFor,
  thumbKeyFor,
} from "../attachments/attachment.naming";
import { RENDERABLE_MIMES, verifyUpload } from "../attachments/attachment.sniff";
import { scanBuffer } from "./fileScan";

const BYTES_PER_MB = 1024 * 1024;

export type AttachmentValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_many"; max: number }
  | { ok: false; reason: "too_large"; file: string; maxMb: number }
  | { ok: false; reason: "total_too_large"; maxMb: number }
  | { ok: false; reason: "unsupported_type"; file: string; detail: string };

/**
 * Everything that can be decided BEFORE a ticket exists: count, size, and
 * declared/actual type. Called before `submitIntake` (step 3) so a bad file
 * answers its own 413/415 without a ticket, a submission or a consent log
 * ever being written — the same "no partial writes on error" rule the field
 * validator enforces for consent.
 *
 * Re-checks type by magic bytes here, not just later in
 * `persistIntakeAttachments`, so the request fails BEFORE the transaction
 * that needs to succeed or fully roll back, rather than after.
 */
export function validateIntakeAttachments(
  files: UploadedFile[],
): AttachmentValidationResult {
  const { maxFileMb, maxFiles, maxTotalMb } = env.publicIntake;

  if (files.length > maxFiles) {
    return { ok: false, reason: "too_many", max: maxFiles };
  }

  let total = 0;
  for (const file of files) {
    if (file.size > maxFileMb * BYTES_PER_MB) {
      return { ok: false, reason: "too_large", file: file.originalname, maxMb: maxFileMb };
    }
    total += file.size;
  }
  if (total > maxTotalMb * BYTES_PER_MB) {
    return { ok: false, reason: "total_too_large", maxMb: maxTotalMb };
  }

  for (const file of files) {
    const verified = verifyUpload({
      buffer: file.buffer,
      declaredType: file.mimetype,
      allowed: ALLOWED_TYPES,
    });
    if (!verified.ok) {
      return {
        ok: false,
        reason: "unsupported_type",
        file: file.originalname,
        detail: verified.reason,
      };
    }
  }

  return { ok: true };
}

/**
 * Store the files and create their Attachment rows, once the ticket and
 * submission already exist (called right after `persistIntake` — see
 * intake.service.ts). Assumed already validated by
 * `validateIntakeAttachments`; `verifyUpload` runs again here anyway, because
 * this function has to be correct standing alone, not just when called in the
 * right order — the same belt-and-braces stance `requiresResolution` takes
 * (checked in the service AND the repository).
 *
 * Bytes land in the SAME storage a signed-in upload uses — there is no
 * separate physical quarantine area. "Quarantine" is the `scanStatus: pending`
 * row plus `attachmentService.read()` refusing to serve anything that is not
 * `clean` (or, for an ordinary upload, `null`) — see that function's own
 * comment. The scan itself is fired without being awaited: the ticket does
 * not wait on it (design doc §08.3), and a scan that never resolves (clamd
 * unreachable) leaves the row `pending` rather than blocking the response.
 */
export async function persistIntakeAttachments(
  ticketId: number,
  submissionId: number,
  uploaderId: number,
  files: UploadedFile[],
): Promise<AttachmentDto[]> {
  if (files.length === 0) return [];

  const storageProvider = env.storageDriver === "s3" ? "s3" : "disk";
  const created: AttachmentDto[] = [];
  let sequence = (await attachmentRepository.countByTicket(ticketId)) + 1;

  for (const file of files) {
    const verified = verifyUpload({
      buffer: file.buffer,
      declaredType: file.mimetype,
      allowed: ALLOWED_TYPES,
    });
    if (!verified.ok) {
      // Cannot happen if validateIntakeAttachments ran first on the same
      // buffers — a defensive throw, not a path a caller is expected to hit.
      throw new Error(`Unverifiable attachment reached persistence: ${verified.reason}`);
    }

    const key = storageKeyFor(verified.ext, randomBytes(16).toString("hex"));
    await storage.save(key, file.buffer);
    const checksum = createHash("sha256").update(file.buffer).digest("hex");

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
          logger.warn({ err: cause }, "public intake: could not store thumbnail");
        }
      }
    }

    const row = await attachmentRepository.create({
      ticketId,
      submissionId,
      uploaderId,
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
      checksum,
      scanStatus: "pending",
      storageProvider,
    });
    sequence += 1;
    created.push(row);

    // Fire-and-forget: the caller (the route, step 6) has already answered the
    // sender by the time this settles.
    void scanAndUpdate(row.id, key, file.buffer);
  }

  return created;
}

/**
 * Run the scan and act on the verdict. `clean`/`infected` are terminal here;
 * `error` (clamd unreachable, timed out, or answered something this cannot
 * parse) deliberately leaves the row at `pending` rather than writing `error`
 * — see fileScan.ts and design doc §08.3 ("error → stays pending, retried").
 * There is no retry SWEEP yet to actually retry it; that is a follow-up, not
 * a claim this function makes.
 */
async function scanAndUpdate(
  attachmentId: number,
  storageKey: string,
  buffer: Buffer,
): Promise<void> {
  const result = await scanBuffer(buffer);

  if (result.verdict === "error") {
    logger.warn(
      { attachmentId, detail: result.detail },
      "public intake: virus scan unavailable, attachment stays pending",
    );
    return;
  }

  if (result.verdict === "infected") {
    logger.warn(
      { attachmentId, detail: result.detail },
      "public intake: infected attachment removed from storage",
    );
    // Bytes go; the row stays, marked infected, so triage can see something
    // was caught rather than finding a silent gap in the ticket's files.
    // attachmentService.read() already refuses anything but `clean`, so this
    // is belt-and-braces against the bytes being read some other way.
    try {
      await storage.delete(storageKey);
    } catch (cause) {
      logger.warn({ err: cause, attachmentId }, "public intake: could not delete infected file");
    }
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { scanStatus: "infected", scannedAt: new Date() },
    });
    return;
  }

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { scanStatus: "clean", scannedAt: new Date() },
  });
}
