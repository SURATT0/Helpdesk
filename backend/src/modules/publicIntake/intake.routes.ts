import { Router, type ErrorRequestHandler } from "express";
import multer from "multer";
import { asyncHandler } from "../../middlewares";
import { env } from "../../config/env";
import { intakeCors } from "./intake.cors";
import { intakeController } from "./intake.controller";
import {
  intakeEmailHourLimiter,
  intakeIpHourLimiter,
  intakeIpMinuteLimiter,
} from "./intake.rate-limit";

/**
 * Buffered in memory, same as the ticket-attachment upload
 * (attachment.routes.ts) — files are small enough (design doc caps: 10MB per
 * file, 25MB total, 5 files) that streaming to disk first buys nothing.
 *
 * Limits set ABOVE the real caps on purpose: this is a backstop against a
 * pathological request (memory exhaustion from an enormous body), not the
 * enforcement point. The real, correctly-formatted 413/415 responses come
 * from `validateIntakeAttachments` (step 4) via `submitIntake`, which also
 * catches the one thing multer's per-file limit cannot — a COMBINED size
 * over the total cap from several individually-small files. Setting multer's
 * own ceiling at the documented cap instead would mean an ordinary
 * over-limit upload gets multer's generic error shape here instead of the
 * documented one there.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.publicIntake.maxFileMb * 2 * 1024 * 1024,
    files: env.publicIntake.maxFiles + 1,
  },
});

/**
 * Translate ONLY multer's own errors into the public wire shape; anything
 * else falls through to the app's generic error handler. Declared with all
 * four parameters so Express recognises it as error-handling middleware —
 * dropping `next` would make this an ordinary (never-called-on-error)
 * middleware instead.
 */
const handleMulterError: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooManyFiles =
      err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE";
    res.status(413).json({
      error: "file_too_large",
      max: tooManyFiles
        ? `${env.publicIntake.maxFiles} files`
        : `${env.publicIntake.maxFileMb}MB`,
    });
    return;
  }
  next(err);
};

/**
 * Public inbound intake form. Mounted WITHOUT `requireAuth` in app.ts —
 * following the exact pattern `emailWebhookRoutes` already uses for the
 * inbound-email webhook, which is what makes this safe: `requireAuth` is
 * applied per-router at the mount point, never as a blanket app-level gate,
 * so leaving it off here cannot cause any OTHER route to lose it.
 *
 * Order matters: CORS must run first (so a preflight OPTIONS never reaches
 * anything else), the two IP limiters next (cheap, need no parsed body), then
 * the body is parsed (multer for multipart, or already parsed by the
 * app-level `express.json()` for JSON — both a no-op for the other content
 * type), THEN the per-email limiter, which needs `req.body.businessEmail`.
 */
export const publicIntakeRoutes = Router();
// `.use()`, not `.post()`: a route registered only for POST never matches an
// OPTIONS preflight, so `cors` (which handles OPTIONS itself, ending the
// response) would simply never run for one — Express's own auto-generated
// OPTIONS responder (a bare `Allow: POST`, no CORS headers at all) would
// answer instead, and every cross-origin browser request would fail despite
// PUBLIC_FORM_ORIGIN being configured correctly.
publicIntakeRoutes.use(intakeCors);
publicIntakeRoutes.post(
  "/",
  intakeIpMinuteLimiter,
  intakeIpHourLimiter,
  upload.array("attachments", env.publicIntake.maxFiles + 1),
  handleMulterError,
  intakeEmailHourLimiter,
  asyncHandler(intakeController.submit),
);
