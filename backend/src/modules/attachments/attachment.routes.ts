import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { BadRequest } from "../../shared/errors";
import { attachmentController } from "./attachment.controller";
import { ALLOWED_TYPES } from "./attachment.service";

/**
 * Files buffered in memory, then handed to IFileStorage. 25 MB cap per file.
 *
 * The type check here is a cheap door, not the gate: `file.mimetype` is whatever
 * the client wrote in the multipart part, so it can only reject the obviously
 * unwanted before the bytes are read. What a file actually IS gets decided from
 * its own magic bytes in `attachmentService.upload` — see attachment.sniff — and
 * a file that passes this filter can still be refused there.
 *
 * The allowlist lives with the service so this and the verifier cannot disagree.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    cb(BadRequest(`Unsupported file type: ${file.mimetype}`));
  },
});

// Nested under /tickets/:ticketId/attachments (mergeParams exposes :ticketId).
export const ticketAttachmentRoutes = Router({ mergeParams: true });
ticketAttachmentRoutes.get("/", asyncHandler(attachmentController.list));
ticketAttachmentRoutes.post(
  "/",
  upload.single("file"),
  asyncHandler(attachmentController.upload),
);

// Flat /attachments/:id for authed download + delete. Both are behind
// `requireAuth` at the mount point and re-check the parent ticket's row scope in
// the service, so a URL alone never serves bytes.
export const attachmentRoutes = Router();
// Declared before `/:id` so the literal segment is never read as an id.
attachmentRoutes.get("/:id/thumb", asyncHandler(attachmentController.thumbnail));
attachmentRoutes.get("/:id", asyncHandler(attachmentController.download));
attachmentRoutes.delete(
  "/:id",
  requirePermission("ticket:write"),
  asyncHandler(attachmentController.remove),
);
