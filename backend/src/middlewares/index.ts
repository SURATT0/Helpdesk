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

/** `customer_id` → `customerId`, so the client sees the field it sent. */
const toCamel = (column: string) =>
  column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * A uniqueness collision that only the database could see.
 *
 * Duck-typed on the error's own `code` rather than `instanceof
 * Prisma.PrismaClientKnownRequestError`: the check then survives a client
 * regenerated at a different version, and this middleware keeps knowing nothing
 * about the ORM behind the repositories.
 *
 * Without this, P2002 fell through to the 500 branch — so creating a project
 * whose name was taken answered "Something went wrong", with the actual reason
 * visible only in the server log. Every unique constraint in the schema was in
 * the same position; mapping it here fixes all of them at once rather than
 * per-endpoint.
 */
function uniqueViolation(
  err: unknown,
): { fields: string[]; model: string | null } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as {
    code?: unknown;
    meta?: { target?: unknown; modelName?: unknown };
  };
  if (e.code !== "P2002") return null;
  // `target` is the column list for most connectors, occasionally a bare string.
  const raw = e.meta?.target;
  const fields = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === "string").map(toCamel)
    : typeof raw === "string"
      ? [toCamel(raw)]
      : [];
  const model = typeof e.meta?.modelName === "string" ? e.meta.modelName : null;
  return { fields, model };
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
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }
  const duplicate = uniqueViolation(err);
  if (duplicate) {
    const { fields, model } = duplicate;
    const subject = model ? model.toLowerCase() : "record";
    const message = fields.length
      ? `A ${subject} with the same ${fields.join(" and ")} already exists`
      : `That ${subject} already exists`;
    log.warn({ code: "CONFLICT", model, fields }, message);
    return res.status(409).json({
      error: {
        code: "CONFLICT",
        message,
        ...(fields.length ? { details: { fields } } : {}),
      },
    });
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
