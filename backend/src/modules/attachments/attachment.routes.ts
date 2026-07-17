import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../middlewares";
import { requirePermission } from "../../middlewares/auth";
import { BadRequest } from "../../shared/errors";
import { attachmentController } from "./attachment.controller";

// Help-desk-appropriate upload types (images, PDFs, text/CSV, common docs, zip).
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Files buffered in memory, then handed to IFileStorage. 25 MB cap per file;
// content-type is restricted to the allowlist above (rejected → 400).
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

// Flat /attachments/:id for authed download + delete.
export const attachmentRoutes = Router();
attachmentRoutes.get("/:id", asyncHandler(attachmentController.download));
attachmentRoutes.delete(
  "/:id",
  requirePermission("ticket:write"),
  asyncHandler(attachmentController.remove),
);
