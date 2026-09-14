/**
 * Typed application errors. Controllers throw these; the error middleware
 * turns them into `{ error: { code, message, details? } }` JSON with the right
 * status.
 *
 * **The `code` is the part a person reads.** Not directly — the web app looks it
 * up in its own dictionary and shows the sentence in whichever language the
 * reader picked. The `message` here is for a log, a stack trace and a developer
 * with curl; it is written in English and it is never put on a screen, because
 * nothing in this process knows what language the person on the other end reads.
 * That is the whole reason these constructors exist rather than a bare
 * `BadRequest("some sentence")`: a sentence cannot be translated by the client,
 * a code can.
 *
 * So: anything a person can actually reach through the product gets its OWN
 * code, and anything that needs a number or a name in the sentence puts it in
 * `details` rather than only in the message — the client has to interpolate its
 * own translation, and cannot pick a count back out of English prose.
 *
 * The generic four (`BadRequest`, `NotFound`, `Forbidden`, `Unauthorized`)
 * remain for guards a working client never trips: a malformed id, an unknown
 * foreign key, a route the UI does not offer. Those surface as "something was
 * wrong with that request" in the reader's language, which is the honest amount
 * to say about a state the product is not supposed to be able to produce.
 *
 * `frontend/src/lib/api-error.ts` mirrors this list. The two files do not import
 * from each other — same convention as `shared/ticket-status.ts` — so a new code
 * here needs its twin there, and a test on each side fails until it has one.
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
    { from, to },
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
    { scope },
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
    { count },
  );

/**
 * Thrown when deleting a project that people still route through.
 *
 * Same shape and reasoning as `HasOpenQueue` above, deliberately: a 409, because
 * the request is well formed and will succeed once the members have been moved.
 *
 * Members rather than tickets. A ticket carries no project — routing reads the
 * REQUESTER's project when the ticket is created and keeps only the assignee it
 * chose — so "tickets in this project" is not a question the data can answer.
 * What deletion would actually break is routing, and membership is exactly what
 * routing reads, so that is what this guards. Owners and backup owners count as
 * members here: an empty project is one nobody is pointed at.
 */
export const ProjectHasMembers = (count: number) =>
  new AppError(
    409,
    "PROJECT_HAS_MEMBERS",
    `This project still has ${count} member${count === 1 ? "" : "s"} routing through it — move them first`,
    { count },
  );

/**
 * Thrown when archiving a customer that still has something live under it.
 *
 * Says what is in the way and how much of it, rather than "cannot archive": the
 * caller's next step is to move or close those things, and a count is what tells
 * them whether that is five minutes or a project. Same shape and same reasoning
 * as ProjectHasMembers above.
 */
export const CustomerNotEmpty = (counts: {
  projects: number;
  tickets: number;
  users: number;
}) => {
  const parts = [
    counts.tickets > 0 ? `${counts.tickets} open ticket${counts.tickets === 1 ? "" : "s"}` : null,
    counts.projects > 0 ? `${counts.projects} project${counts.projects === 1 ? "" : "s"}` : null,
    counts.users > 0 ? `${counts.users} user${counts.users === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return new AppError(
    409,
    "CUSTOMER_NOT_EMPTY",
    `This customer still has ${parts.join(", ")} — close or move them first`,
    // The counts, not the assembled phrase: the client writes the same list in
    // its own language, and cannot take three numbers back out of English prose.
    counts,
  );
};

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

/* ------------------------------------------------------------------------- *
 * Signing in
 *
 * Four of these are reached only AFTER the password has been verified, so
 * naming the real state reveals nothing an attacker did not already have — and
 * a person told "invalid email or password" when their password is right will
 * reset it twice before they ask anyone. `InvalidCredentials` is the uniform one
 * that comes first, and it must stay uniform.
 * ------------------------------------------------------------------------- */

export const InvalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

export const AccountDeactivated = () =>
  new AppError(
    401,
    "ACCOUNT_DEACTIVATED",
    "This account has been deactivated — contact your administrator",
  );

export const AccountRejected = () =>
  new AppError(
    401,
    "ACCOUNT_REJECTED",
    "This registration was not approved — contact your administrator",
  );

export const AccountSuspended = () =>
  new AppError(
    401,
    "ACCOUNT_SUSPENDED",
    "This account has been suspended — contact your administrator",
  );

export const EmailNotVerified = () =>
  new AppError(
    401,
    "EMAIL_NOT_VERIFIED",
    "Confirm your email address first — check your inbox for the confirmation link",
  );

export const AccountPendingApproval = () =>
  new AppError(
    401,
    "ACCOUNT_PENDING_APPROVAL",
    "Your account is waiting for an administrator to approve it. You will be emailed when it is.",
  );

/** The `is_active` gate on an already-authenticated request. */
export const AccountNotActive = () =>
  new AppError(403, "ACCOUNT_NOT_ACTIVE", "This account is not active");

/* ------------------------------------------------------------------------- *
 * Sessions and links
 * ------------------------------------------------------------------------- */

/** No bearer token, an unreadable one, or a session that is simply over. */
export const SessionExpired = (message = "Session expired") =>
  new AppError(401, "SESSION_EXPIRED", message);

/**
 * A refresh token that had already been spent.
 *
 * Its own code because the consequence differs: the whole family is revoked, so
 * every other device this person was signed in on has just been signed out too,
 * and "your session expired" would leave them wondering why it keeps happening.
 */
export const SessionReused = () =>
  new AppError(401, "SESSION_REUSED", "Session reuse detected");

export const VerificationLinkInvalid = () =>
  new AppError(
    400,
    "VERIFICATION_LINK_INVALID",
    "This confirmation link is no longer valid — request a new one",
  );

export const ResetLinkInvalid = () =>
  new AppError(
    400,
    "RESET_LINK_INVALID",
    "This reset link is no longer valid — request a new one",
  );

/**
 * A permission the role does not carry.
 *
 * The permission name rides in `details` as well as in the message: the client
 * shows a general sentence, and the name is what makes a support conversation
 * about it short.
 */
export const MissingPermission = (permission: string) =>
  new AppError(403, "MISSING_PERMISSION", `Missing permission: ${permission}`, {
    permission,
  });

/* ------------------------------------------------------------------------- *
 * Answering, working and closing a ticket
 * ------------------------------------------------------------------------- */

/** Someone other than the requester tried to answer a closure. */
export const NotYourTicketToAnswer = () =>
  new AppError(
    403,
    "NOT_YOUR_TICKET_TO_ANSWER",
    "Only the person who raised a ticket can answer its closure",
  );

/**
 * The requester's confirm/reject arrived for a ticket that is not `pending`.
 *
 * Carries the state it IS in, because the page's next move is to re-render at
 * that state and the sentence should name it.
 */
export const TicketNotAwaitingAnswer = (actual: string) =>
  new AppError(
    400,
    "TICKET_NOT_AWAITING_ANSWER",
    `This ticket is "${actual}", not awaiting an answer`,
    { actual },
  );

/** A handover whose source and target are the same person. */
export const SameAssignee = () =>
  new AppError(400, "SAME_ASSIGNEE", "Source and target assignee are the same");

/** A ticket pointed at somebody who cannot take tickets. */
export const NotAssignable = (userId: number) =>
  new AppError(
    403,
    "NOT_ASSIGNABLE",
    `User #${userId} cannot be assigned tickets`,
    { userId },
  );

/* ------------------------------------------------------------------------- *
 * Managing people, projects and customers
 * ------------------------------------------------------------------------- */

/** A change to your own account that you must not be the one to make. */
export const CannotActOnSelf = (act: "deactivate" | "customer_access") =>
  new AppError(
    act === "deactivate" ? 400 : 403,
    act === "deactivate" ? "CANNOT_DEACTIVATE_SELF" : "CANNOT_CHANGE_OWN_ACCESS",
    act === "deactivate"
      ? "You cannot deactivate your own account"
      : "You cannot change your own customer access",
  );

/**
 * Something only a platform-wide super admin may do.
 *
 * One code with the act in `details` rather than three codes: the reader's
 * problem is identical in every case — they are not platform staff — and the act
 * is what a support conversation needs, not a different sentence.
 */
export const PlatformStaffOnly = (
  act: "approve_registration" | "decide_registration" | "grant_super_admin",
) =>
  new AppError(
    403,
    "PLATFORM_STAFF_ONLY",
    act === "grant_super_admin"
      ? "Only a platform super admin can grant the super admin role"
      : act === "approve_registration"
        ? "Only a platform super admin can approve a registration"
        : "Only a platform super admin can decide a registration",
    { act },
  );

/** A person who cannot hold a project. */
export const CannotOwnProject = (userId: number) =>
  new AppError(
    403,
    "CANNOT_OWN_PROJECT",
    `User #${userId} cannot own a project`,
    { userId },
  );

/**
 * Something the role may not manage at all.
 *
 * `subject` says what, and the client has a sentence per subject — "you do not
 * have permission to manage customers" is worth saying plainly, because the
 * person is usually looking at a button they should not have been shown.
 */
export const NotYoursToManage = (
  subject: "customers" | "customer_archive" | "projects",
) =>
  new AppError(
    403,
    "NOT_YOURS_TO_MANAGE",
    subject === "customers"
      ? "You don't have permission to manage customers"
      : subject === "customer_archive"
        ? "You don't have permission to archive customers"
        : "You don't have permission to delete projects",
    { subject },
  );

/* ------------------------------------------------------------------------- *
 * Files
 * ------------------------------------------------------------------------- */

export const NoFileUploaded = () =>
  new AppError(400, "NO_FILE_UPLOADED", "No file uploaded (field 'file')");

export const UnsupportedFileType = (mimetype: string) =>
  new AppError(
    400,
    "UNSUPPORTED_FILE_TYPE",
    `Unsupported file type: ${mimetype}`,
    { mimetype },
  );

export const NotAnImage = () =>
  new AppError(400, "NOT_AN_IMAGE", "Attachment is not an image");

export const AttachmentGone = () =>
  new AppError(
    404,
    "ATTACHMENT_GONE",
    "Attachment file is no longer available in storage",
  );

/* ------------------------------------------------------------------------- *
 * Comments
 * ------------------------------------------------------------------------- */

export const InternalNotesAreForAgents = () =>
  new AppError(
    403,
    "INTERNAL_NOTES_ARE_FOR_AGENTS",
    "Only agents can add internal notes",
  );

export const CannotDeleteComment = () =>
  new AppError(403, "CANNOT_DELETE_COMMENT", "Cannot delete this comment");

/* ------------------------------------------------------------------------- *
 * Reading other people's views
 * ------------------------------------------------------------------------- */

/**
 * A filter that would show somebody else's work.
 *
 * One code for the three places that refuse it — the ticket list's "my queue",
 * the audit trail's "my actions", the workload report's "me" — because the
 * reader's problem and the fix are the same in all three: they asked for a view
 * that is not theirs. `scope` says which, for a log.
 */
export const NotYoursToRead = (scope: "queue" | "audit" | "workload") =>
  new AppError(
    403,
    "NOT_YOURS_TO_READ",
    scope === "queue"
      ? "You may only filter the ticket list by your own queue"
      : scope === "audit"
        ? "You may only filter the audit trail by your own actions"
        : "You may only read your own workload",
    { scope },
  );

/** The agent workload report, which is platform staff only. */
export const WorkloadIsStaffOnly = () =>
  new AppError(
    403,
    "WORKLOAD_IS_STAFF_ONLY",
    "Agent workload is visible to super admins only",
  );

/* ------------------------------------------------------------------------- *
 * Integrations
 * ------------------------------------------------------------------------- */

export const SourceNotConfigured = (label: string) =>
  new AppError(400, "SOURCE_NOT_CONFIGURED", `${label} is not configured`, {
    label,
  });

/**
 * Every code above, plus the ones the middleware raises without a constructor.
 *
 * This is the list `frontend/src/lib/api-error.ts` mirrors, and the reason it
 * exists here is so a test can walk it: a code with no sentence on the other
 * side is a person reading "something went wrong" where the product knows
 * exactly what happened.
 */
export const ERROR_CODES = [
  // Generic — a guard a working client should not trip.
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INTERNAL",
  "NOT_IMPLEMENTED",
  "SERVICE_UNAVAILABLE",
  // Raised by the error middleware rather than by a constructor.
  "VALIDATION_ERROR",
  "UPLOAD_ERROR",
  "PAYLOAD_TOO_LARGE",
  // Signing in.
  "INVALID_CREDENTIALS",
  "ACCOUNT_DEACTIVATED",
  "ACCOUNT_REJECTED",
  "ACCOUNT_SUSPENDED",
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_PENDING_APPROVAL",
  "ACCOUNT_NOT_ACTIVE",
  // Sessions and links.
  "SESSION_EXPIRED",
  "SESSION_REUSED",
  "VERIFICATION_LINK_INVALID",
  "RESET_LINK_INVALID",
  "MISSING_PERMISSION",
  // Tickets.
  "ILLEGAL_TRANSITION",
  "CONCURRENT_STATUS_CHANGE",
  "REOPEN_WINDOW_EXPIRED",
  "NOT_YOUR_TICKET_TO_ANSWER",
  "TICKET_NOT_AWAITING_ANSWER",
  "SAME_ASSIGNEE",
  "NOT_ASSIGNABLE",
  // People, projects, customers.
  "LAST_ADMIN",
  "USER_HAS_OPEN_QUEUE",
  "PROJECT_HAS_MEMBERS",
  "CUSTOMER_NOT_EMPTY",
  "CANNOT_DEACTIVATE_SELF",
  "CANNOT_CHANGE_OWN_ACCESS",
  "PLATFORM_STAFF_ONLY",
  "CANNOT_OWN_PROJECT",
  "NOT_YOURS_TO_MANAGE",
  // Files.
  "NO_FILE_UPLOADED",
  "UNSUPPORTED_FILE_TYPE",
  "NOT_AN_IMAGE",
  "ATTACHMENT_GONE",
  // Comments.
  "INTERNAL_NOTES_ARE_FOR_AGENTS",
  "CANNOT_DELETE_COMMENT",
  // Other people's views.
  "NOT_YOURS_TO_READ",
  "WORKLOAD_IS_STAFF_ONLY",
  // Integrations.
  "SOURCE_NOT_CONFIGURED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
