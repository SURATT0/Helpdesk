/**
 * How this app compares two pieces of text for ordering.
 *
 * Thai has leading vowels — เ แ โ ใ ไ — written before their consonant and
 * sorted after it. They sit above every Thai consonant in Unicode, so anything
 * that compares code points (`.sort()` with no comparator, `<`, `>`) puts every
 * word beginning with one at the end of the list: "เกม" lands after
 * "ฮาร์ดดิสก์" instead of beside "กบ" and "ไก่". `Intl.Collator` knows better;
 * nothing else here does.
 *
 * **One instance, built once at module scope.** A collator is expensive to
 * construct and free to reuse, and `a.localeCompare(b)` builds a fresh one on
 * every single comparison — which is n log n constructions for one sort, and
 * visibly slow by a few hundred rows. This is the object; `compareText` is its
 * `compare`, already bound.
 *
 * `'th-TH'`, not the runtime default. `localeCompare()` with no argument asks
 * the browser's locale, so the same list came out Thai-first for a reader in
 * Bangkok and English-first for one in London — and neither matched the server.
 * Pinning the locale is what makes one answer.
 *
 * `sensitivity: 'base'` folds case and accents, so "Network" and "network"
 * compare equal and sort adjacently rather than a block apart.
 *
 * `numeric: true` reads runs of digits as numbers, so "Project 2" comes before
 * "Project 10" instead of after it.
 *
 * Mirrors `COLLATE "th-TH-x-icu"` on the database side — see
 * `docs/thai-collation.md`, including the one place the two differ on purpose.
 */
const collator = new Intl.Collator("th-TH", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Compare two strings for display order: Thai first, Latin after, case folded,
 * digits read as numbers.
 *
 * Bound to the instance above, so it can be passed straight to `.sort()` without
 * building anything per call.
 */
export const compareText: (a: string, b: string) => number = collator.compare;

/**
 * Compare two values that may be absent, putting the absent ones last.
 *
 * For columns like the ticket table's assignee, where "unassigned" is a real and
 * common state. Sorting `null` as an empty string would file every unassigned
 * ticket at the TOP, which is the opposite of useful: the rows a reader is
 * looking for are the ones with a name on them.
 */
export function compareTextLast(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return compareText(a, b);
}
