/**
 * "Other (please describe)" on the category picker, client side.
 *
 * Mirrors `backend/src/shared/category-other.ts` — the same arrangement as
 * `lib/ticket-status.ts` and `lib/permissions.ts`, and for the same reason: the
 * two packages do not import from each other, and the client has to know which
 * option to show a textarea for.
 *
 * The server is what actually refuses. Nothing here is the gate — a blank
 * description is a 400 from the API whatever this file believes, and that is
 * deliberate, because the form is not the only way to file a ticket. What this
 * buys is that the person is asked before the round trip instead of refused
 * after it.
 *
 * `code`, not the name and not the id. Each customer owns its own copy of the
 * row, so there is no single id to compare against; and the NAME is a display
 * decision a tenant may translate into Thai, which would leave a name-matching
 * client unable to find its own escape hatch.
 */

export const OTHER_CATEGORY_CODE = "OTHER";

/** Does filing under this category require the person to say what it is? */
export function needsOwnDescription(categoryCode: string | undefined): boolean {
  return categoryCode === OTHER_CATEGORY_CODE;
}

/**
 * Put "Other" last, whatever the server sent.
 *
 * The API orders categories by customer then name, which drops "Other" into the
 * middle of the alphabet. It belongs at the end: it is the answer for a ticket
 * none of the others fit, and offering it before them invites it as a first
 * choice — which is exactly how a free-text field becomes the category everybody
 * uses.
 *
 * Stable otherwise: the rest keep the order they arrived in.
 */
export function otherLast<T extends { code: string }>(categories: T[]): T[] {
  return [
    ...categories.filter((c) => !needsOwnDescription(c.code)),
    ...categories.filter((c) => needsOwnDescription(c.code)),
  ];
}

/** Why the form is not ready to submit, or null when it is. */
export function whyNotReady(input: {
  categoryCode: string | undefined;
  categoryOther: string;
}): "detail_missing" | null {
  if (!needsOwnDescription(input.categoryCode)) return null;
  return input.categoryOther.trim().length === 0 ? "detail_missing" : null;
}
