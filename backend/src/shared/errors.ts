/**
 * Typed application errors. Controllers throw these; the error middleware
 * turns them into `{ error: { code, message } }` JSON with the right status.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const NotFound = (message = "Not found") =>
  new AppError(404, "NOT_FOUND", message);

export const BadRequest = (message = "Bad request") =>
  new AppError(400, "BAD_REQUEST", message);

export const Unauthorized = (message = "Unauthorized") =>
  new AppError(401, "UNAUTHORIZED", message);

export const Forbidden = (message = "Forbidden") =>
  new AppError(403, "FORBIDDEN", message);

/** A feature/adapter that exists but isn't wired up yet (e.g. a source stub). */
export const NotImplemented = (message = "Not implemented") =>
  new AppError(501, "NOT_IMPLEMENTED", message);

/** A feature that is present but disabled by configuration (e.g. no secret set). */
export const ServiceUnavailable = (message = "Service unavailable") =>
  new AppError(503, "SERVICE_UNAVAILABLE", message);

/** Thrown when a ticket status change is not in the transition whitelist. */
export const IllegalTransition = (from: string, to: string) =>
  new AppError(
    409,
    "ILLEGAL_TRANSITION",
    `Cannot move ticket from "${from}" to "${to}"`,
  );

/** Thrown when reopening a ticket closed more than 30 days ago. */
export const ReopenWindowExpired = (
  message = "Reopen window (30 days) has expired — open a new ticket instead",
) => new AppError(409, "REOPEN_WINDOW_EXPIRED", message);
