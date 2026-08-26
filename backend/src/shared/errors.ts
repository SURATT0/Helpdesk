/**
 * Typed application errors. Controllers throw these; the error middleware
 * turns them into `{ error: { code, message } }` JSON with the right status.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /**
     * Machine-readable specifics, echoed under `error.details`. Only for things
     * a client can act on — which field collided, say. The message stays the
     * thing a human reads.
     */
    public readonly details?: Record<string, unknown>,
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

/**
 * A uniqueness collision — something already exists with these values.
 *
 * Available for services that can see the collision coming and would rather say
 * so than race the database for it. The error middleware raises the same shape
 * from Prisma's P2002 for the ones that only surface at the insert, so both
 * routes answer a client identically.
 */
export const Conflict = (message = "Already exists", fields?: string[]) =>
  new AppError(409, "CONFLICT", message, fields ? { fields } : undefined);

/** Thrown when a ticket status change is not in the transition whitelist. */
export const IllegalTransition = (from: string, to: string) =>
  new AppError(
    409,
    "ILLEGAL_TRANSITION",
    `Cannot move ticket from "${from}" to "${to}"`,
  );

/**
 * Thrown when a change would leave nobody able to administer something.
 *
 * Two shapes of the same mistake, and only one of them is recoverable, which is
 * why the message differs: a customer with no super admin left can still be
 * helped by platform staff, whereas the last PLATFORM-WIDE super admin is the end
 * of the line — only a platform-wide super admin may grant that role, so removing
 * the last one cannot be undone from inside the product at all.
 */
export const LastAdmin = (scope: "platform" | "customer") =>
  new AppError(
    409,
    "LAST_ADMIN",
    scope === "platform"
      ? "This is the only active platform super admin — promote another one first, or nobody will be able to grant that role again"
      : "This is the only active super admin for their customer — promote another one first",
  );

/**
 * Thrown when closing an account that still holds unfinished work.
 *
 * A 409 rather than a 400: the request is well formed and will succeed once the
 * queue has been handed over, which is what the message points at.
 */
export const HasOpenQueue = (count: number) =>
  new AppError(
    409,
    "USER_HAS_OPEN_QUEUE",
    `This person still has ${count} unfinished ticket${count === 1 ? "" : "s"} assigned — hand the queue over first`,
  );

/** Thrown when reopening a ticket closed more than 30 days ago. */
export const ReopenWindowExpired = (
  message = "Reopen window (30 days) has expired — open a new ticket instead",
) => new AppError(409, "REOPEN_WINDOW_EXPIRED", message);

/**
 * Thrown when a status change lost a race: the ticket moved between the read
 * that validated the transition and the write that would have applied it.
 *
 * A 409 rather than a silent retry against the new status. The whitelist is
 * defined over the status the client was looking at, so re-validating from
 * wherever the ticket has since landed could apply a move the user never chose —
 * "resolve this open ticket" is not consent to resolve an in-progress one. The
 * message carries the status we actually found so the client can re-render and
 * let the user decide again.
 */
export const ConcurrentStatusChange = (
  attemptedFrom: string,
  to: string,
  actual: string,
) =>
  new AppError(
    409,
    "CONCURRENT_STATUS_CHANGE",
    `Ticket moved to "${actual}" while you were changing it from "${attemptedFrom}" to "${to}" — reload and try again`,
    { attemptedFrom, to, actual },
  );
