/**
 * "Other (please describe)" — the escape hatch on the category picker, and the
 * one rule that keeps it from becoming a second, worse category list.
 *
 * A person filing a ticket that fits none of the six categories used to have to
 * pick the least wrong one. The honest answer is a seventh option that asks what
 * it actually is — but the text they type must NOT become a category row. Left
 * to free text, "เน็ตช้า" and "เน็ทช้า" are two categories that mean one thing,
 * and every report that groups by category quietly splits in half. So the typed
 * text lives on the TICKET (`tickets.category_other`), and turning a recurring
 * one into a real category is a deliberate act by a person who can see them all
 * side by side.
 *
 * `code`, not name or id, is what identifies this option. Each customer owns its
 * own copy of the row — that is how every category works since they stopped
 * being shared — so there is no single id to compare against, and the name is a
 * display decision a tenant may translate or reword. `OTHER` is the identity
 * that survives both, exactly as `NETWORK` does.
 *
 * `frontend/src/lib/category-other.ts` mirrors this. The two files do not import
 * from each other — the same arrangement as `shared/ticket-status.ts` — because
 * the client has to know which option to show a textarea for, and the server has
 * to be the one that actually refuses.
 */

/** The category whose whole meaning is "none of the above, here is what it is". */
export const OTHER_CATEGORY_CODE = "OTHER";

/** The display name a new customer's copy is created with. */
export const OTHER_CATEGORY_NAME = "Other";

/**
 * Does filing under this category require the person to say what it is?
 *
 * Expressed over the CODE rather than over a row, so it answers the same way for
 * every tenant's copy and needs no database read to decide.
 */
export function needsOwnDescription(categoryCode: string): boolean {
  return categoryCode === OTHER_CATEGORY_CODE;
}

export type CategoryOtherProblem =
  | { reason: "missing" }
  /**
   * Text was sent for a category that does not ask for any.
   *
   * Refused rather than ignored. Silently dropping it would lose something the
   * person typed and meant; and a client that fills this field for an ordinary
   * category is confused about what it is for, which is worth saying out loud
   * while it is still one client rather than three.
   */
  | { reason: "not_applicable" };

/**
 * The single check. Every path that files a ticket asks this and nothing else.
 *
 * Blank-after-trim counts as missing: a space bar is not a description, and the
 * point of the field is that somebody wrote down what went wrong.
 */
export function checkCategoryOther(input: {
  categoryCode: string;
  categoryOther?: string | null;
}): CategoryOtherProblem | null {
  const detail = input.categoryOther?.trim() ?? "";
  if (needsOwnDescription(input.categoryCode)) {
    return detail.length === 0 ? { reason: "missing" } : null;
  }
  return detail.length > 0 ? { reason: "not_applicable" } : null;
}

/**
 * What to store, once the check has passed.
 *
 * Trimmed, and null rather than an empty string for a category that asks for
 * nothing: "nobody wrote one" and "somebody wrote nothing" are the same fact,
 * and two spellings of it in a column is how a later query gets it wrong.
 */
export function storedCategoryOther(input: {
  categoryCode: string;
  categoryOther?: string | null;
}): string | null {
  if (!needsOwnDescription(input.categoryCode)) return null;
  const detail = input.categoryOther?.trim() ?? "";
  return detail.length > 0 ? detail : null;
}

/** The English sentence for a log. The client words its own from the code. */
export function categoryOtherMessage(problem: CategoryOtherProblem): string {
  return problem.reason === "missing"
    ? 'Filing under "Other" needs a description of what the problem actually is'
    : "Only the Other category takes a description of its own";
}
