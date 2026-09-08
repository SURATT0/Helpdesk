/**
 * What the file pickers may offer — mirroring the server's `ALLOWED_TYPES`
 * (`backend/src/modules/attachments/attachment.service.ts`), which is the only
 * thing that actually decides.
 *
 * It was previously written out twice, in the composer and the create-ticket
 * modal, and left off the ticket-level upload entirely. All three disagreed with
 * the server in both directions:
 *
 *   - `image/*` let a picker offer formats the API refuses. On an iPhone that is
 *     the common case rather than the edge one: photos are HEIC, and the upload
 *     came back rejected after the person had already chosen it. Naming the four
 *     formats the server renders also gives Safari what it needs to transcode a
 *     HEIC to JPEG on the way out instead of handing over a file nobody wants.
 *   - Plain text, zip, .doc and .docx are all accepted by the API and were
 *     missing here, so a picker greyed out files that would have uploaded fine.
 *
 * MIME types only, no `.ext` aliases. The old list mixed the two — `image/*`
 * beside `.xls` — which buys nothing on a desktop (every OS maps these
 * extensions to the types below) and is one of the shapes iOS Safari is reported
 * to handle badly.
 *
 * Kept as a list rather than a string so the intent survives a diff; the joined
 * form is what an `accept` attribute wants.
 */
const ACCEPTED_TYPES = [
  // Renderable in a message bubble — the server's RENDERABLE_MIMES.
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // Documents. SVG is deliberately absent on both sides: it can carry script,
  // so an inline one would be an XSS vector.
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** The `accept` attribute for every attachment picker in the app. */
export const ATTACHMENT_ACCEPT = ACCEPTED_TYPES.join(",");

export { ACCEPTED_TYPES };
