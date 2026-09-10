/**
 * The stable identity behind a category's name.
 *
 * Once every customer owns their own categories, Acme's "Network" and Globex's
 * "Network" are two different rows, and a report grouping by category id gets
 * two lines where the desk means one. `categories.code` is what such a report
 * groups by instead, and this is the one place that derives it.
 *
 * Kept identical to the SQL in the migration that added the column
 * (`upper(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g'))`) so a row written by
 * the backfill and a row written by the app carry the same code for the same
 * name. If one of the two ever changes, the other is wrong.
 *
 * A SUGGESTION, not a rule. It is what the create form pre-fills and what the
 * starter set for a new customer uses; a person may type something else, because
 * the whole point of the column is that it survives the name being renamed or
 * translated. Deriving it on every write would defeat that.
 */
export function categoryCode(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}
