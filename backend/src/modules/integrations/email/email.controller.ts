import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../../../config/env";
import { Forbidden, ServiceUnavailable } from "../../../shared/errors";
import { emailService } from "./email.service";
import { normalizeInbound } from "./email.parsers";

/** Constant-time secret comparison (avoids leaking length/prefix via timing). */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const emailController = {
  async inbound(req: Request, res: Response) {
    const secret = env.integrations.email.webhookSecret;
    if (!secret) {
      throw ServiceUnavailable(
        "Email-to-ticket is disabled — set EMAIL_WEBHOOK_SECRET to enable it",
      );
    }
    const provided =
      (req.header("x-webhook-secret") ?? "") ||
      (typeof req.query.secret === "string" ? req.query.secret : "");
    if (!provided || !secretMatches(provided, secret)) {
      throw Forbidden("Invalid or missing webhook secret");
    }

    const mail = normalizeInbound(req.body);
    const result = await emailService.ingest(mail);
    res.status(201).json({ data: result });
  },
};
