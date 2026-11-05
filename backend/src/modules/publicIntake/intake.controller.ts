import type { Request, Response } from "express";
import { logger } from "../../shared/logger";
import type { UploadedFile } from "../attachments/attachment.service";
import { submitIntake, type IntakeOutcome } from "./intake.service";

/** The exact public wire shape (design doc §05) — never the internal `{error:{code,message}}` envelope every authenticated endpoint uses. */
function sendOutcome(res: Response, outcome: IntakeOutcome): void {
  const receivedAt = new Date().toISOString();
  switch (outcome.kind) {
    case "created":
      res.status(201).json({
        ticketNumber: outcome.ticketNumber,
        ref: outcome.ticketNumber,
        status: "received",
        receivedAt,
      });
      return;
    case "spam":
      // Indistinguishable from a real success on purpose — see intake.service.ts.
      res.status(201).json({
        ticketNumber: outcome.fakeTicketNumber,
        ref: outcome.fakeTicketNumber,
        status: "received",
        receivedAt,
      });
      return;
    case "consent_required":
      res.status(422).json({ error: "consent_required" });
      return;
    case "invalid":
      res.status(400).json({ error: "validation", fields: outcome.fields });
      return;
    case "file_rejected":
      if (outcome.reason === "unsupported_type") {
        res.status(415).json({ error: "unsupported_type" });
        return;
      }
      res.status(413).json({
        error: "file_too_large",
        max:
          outcome.reason === "too_many"
            ? `${outcome.max} files`
            : `${outcome.maxMb}MB`,
      });
      return;
  }
}

export const intakeController = {
  /**
   * Files and fields are already parsed by the time this runs — see
   * intake.routes.ts, where multer (for multipart) or the app-level
   * `express.json()` (for JSON) sit ahead of it in the chain, ahead of the
   * per-email rate limiter, which also needs `req.body` populated.
   */
  async submit(req: Request, res: Response): Promise<void> {
    try {
      const files: UploadedFile[] = (
        (req.files as Express.Multer.File[] | undefined) ?? []
      ).map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        buffer: f.buffer,
      }));
      const meta = {
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      };
      const outcome = await submitIntake(
        (req.body as Record<string, unknown> | undefined) ?? {},
        files,
        meta,
      );
      sendOutcome(res, outcome);
    } catch (err) {
      logger.error({ err }, "public intake: submission failed");
      res.status(500).json({ error: "server_error" });
    }
  },
};
