import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../shared/errors";
import { logger } from "../shared/logger";

/** Wrap async route handlers so thrown/rejected errors reach the error mw. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const log = req.log ?? logger;

  if (err instanceof AppError) {
    log.warn({ code: err.code, status: err.status }, err.message);
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    log.warn({ code: "VALIDATION_ERROR", issues: err.issues }, "Invalid request");
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.flatten(),
      },
    });
  }
  // Multer (file upload) errors — e.g. LIMIT_FILE_SIZE.
  if (err instanceof Error && err.name === "MulterError") {
    const code = (err as { code?: string }).code;
    const status = code === "LIMIT_FILE_SIZE" ? 413 : 400;
    log.warn({ code }, err.message);
    return res
      .status(status)
      .json({ error: { code: "UPLOAD_ERROR", message: err.message } });
  }
  // Errors that carry an HTTP status (e.g. body-parser: oversized payload → 413,
  // malformed JSON → 400). Honour their 4xx status instead of masking it as 500.
  if (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    const e = err as { status: number; message?: string; type?: string };
    if (e.status >= 400 && e.status < 500) {
      log.warn({ status: e.status, type: e.type }, e.message ?? "Request error");
      const code =
        e.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST";
      return res
        .status(e.status)
        .json({ error: { code, message: e.message ?? "Request error" } });
    }
  }
  log.error({ err }, "Unhandled error");
  return res
    .status(500)
    .json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
