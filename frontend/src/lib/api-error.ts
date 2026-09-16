import { ApiError } from "./api-client";

/**
 * The one place a refusal from the API becomes a sentence on a screen.
 *
 * The API answers with a `code`, not with copy. It has to: nothing on that side
 * of the wire is told which language the reader picked, so a sentence composed
 * there arrives in English and sits in the middle of a Thai page — which is
 * exactly the bug this file exists to make impossible. `error.<CODE>` in the
 * dictionary is the sentence; `details` carries the values it interpolates,
 * because a translation cannot pick "4" back out of "still has 4 unfinished
 * tickets".
 *
 * **`err.message` is never rendered.** Not as a fallback, not "just for unknown
 * codes" — an unmapped code falls back to the caller's own localised line
 * ("Couldn't save the article", "Couldn't send the link"), which says less but
 * says it in the right language. Every call site already had one of those for
 * the non-ApiError case, so nothing had to be invented to make that true.
 *
 * `backend/src/shared/errors.ts` is the other half. The two files do not import
 * from each other — same convention as `lib/ticket-status.ts` — so `API_ERROR_CODES`
 * below is a mirror, and `api-error.test.ts` fails if a code here has no
 * sentence in either language.
 */

/**
 * Every code the API can answer with, mirrored from `ERROR_CODES` in
 * `backend/src/shared/errors.ts`, plus the two this side raises on its own.
 *
 * Listed so a test can walk it. A code with no dictionary entry is a person
 * reading "couldn't do that" where the product knew exactly what went wrong.
 */
export const API_ERROR_CODES = [
  // Generic — a guard a working client should not trip.
  "BAD_REQUEST",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONFLICT",
  "INTERNAL",
  "NOT_IMPLEMENTED",
  "SERVICE_UNAVAILABLE",
  // Raised by the API's error middleware rather than by a constructor.
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
  "NOT_YOUR_TICKET_TO_EDIT",
  "DESK_ALREADY_STARTED",
  "TICKET_CLOSED_FOR_EDITING",
  "TICKET_NOT_AWAITING_ANSWER",
  "SAME_ASSIGNEE",
  "CATEGORY_DETAIL_REQUIRED",
  "CONVERSATION_CLOSED",
  "NOT_YOUR_TICKET_TO_CANCEL",
  "TICKET_ALREADY_STARTED",
  "RESOLUTION_REQUIRED",
  "NOT_ASSIGNABLE",
  // People, projects, customers.
  "LAST_ADMIN",
  "USER_HAS_OPEN_QUEUE",
  "PROJECT_HAS_MEMBERS",
  "PROJECT_HAS_OPEN_TICKETS",
  "PROJECT_NAME_TAKEN",
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
  // Raised on this side, never sent by the API.
  "NETWORK_ERROR",
  "UNKNOWN",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const KNOWN = new Set<string>(API_ERROR_CODES);

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Values from `details` that a sentence may interpolate.
 *
 * Filtered to strings and numbers rather than passed through whole: `details`
 * comes off the wire, and `t()` does a textual substitution, so an object or an
 * array would land in the page as "[object Object]". Nested shapes (the field
 * list on a CONFLICT, say) are for code to branch on, not for prose.
 */
function params(details: Record<string, unknown> | undefined) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(details ?? {})) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

/**
 * Turn any thrown value into something worth showing a person.
 *
 * @param err        whatever the mutation or query threw
 * @param t          the caller's `t` from `useI18n()`
 * @param fallbackKey a dictionary key for this particular action, used when the
 *                   failure is not an `ApiError` at all or carries a code this
 *                   build does not know — "Couldn't save the article" beats a
 *                   generic, and both beat English.
 */
export function apiErrorMessage(
  err: unknown,
  t: Translate,
  fallbackKey: string,
): string {
  if (!(err instanceof ApiError)) return t(fallbackKey);
  // A code this build has never heard of: a newer API, or a proxy inventing its
  // own error body. The action's own line is the honest thing to show.
  if (!KNOWN.has(err.code)) return t(fallbackKey);
  return t(`error.${err.code}`, params(err.details));
}
