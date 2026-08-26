import { z } from "zod";

/**
 * Builder for the free-text fields a person types — a ticket subject, a ticket
 * description, a comment body.
 *
 * Three things every one of them needs, none of which a bare
 * `z.string().min(n)` provided:
 *
 * - **Trim before measuring.** `min(3)` counts whitespace, so `"   "` was a
 *   valid subject: it produced a ticket with a blank title that no list could
 *   show and no search could find. The trimmed value is also what gets stored,
 *   so the bound and the stored row can never disagree.
 *
 * - **An upper bound.** There was none. Prisma maps `String` to Postgres `text`,
 *   so a 500,000-character description was accepted and stored in full, and then
 *   paid for by every list, export and notification that read the row. The body
 *   parser's 1mb cap was the only backstop, and it answers 413 without naming
 *   the field that overflowed.
 *
 * - **No U+0000.** Postgres cannot hold a NUL in a text column — the INSERT
 *   fails with SQLSTATE 22021 and surfaced as an unhandled 500. That is bad
 *   input, not a server fault, so it is refused here, where the field name is
 *   still known and the answer can be a 400.
 */

/**
 * The character Postgres refuses in any text column (SQLSTATE 22021).
 * Built rather than written as a literal: an editor that writes a real NUL into
 * this source file makes it a binary blob to half the toolchain.
 */
const NUL = String.fromCharCode(0);

const withoutNul = (value: string) => !value.includes(NUL);
const NUL_MESSAGE = "must not contain a NUL character";

/**
 * A trimmed, bounded, NUL-free text field.
 *
 * `min` defaults to 1 — "present and not just spaces", which is the weakest
 * thing any of these fields means. `max` is required: leaving it off is the
 * defect this exists to prevent.
 */
export function freeText({ min = 1, max }: { min?: number; max: number }) {
  return z.string().trim().min(min).max(max).refine(withoutNul, NUL_MESSAGE);
}

/**
 * Caps shared across modules so the same kind of field cannot drift apart.
 * `SUBJECT` matches the 200 that `replyBody.subject` already used; an email
 * subject and a ticket subject are the same kind of field and had no reason to
 * disagree. `BODY` is far above anything a person types (the longest seeded
 * description is 76 characters) and far below what makes a list render badly.
 */
export const TEXT_MAX = {
  SUBJECT: 200,
  BODY: 20_000,
} as const;
