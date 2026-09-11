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

/**
 * How a code reads to a person: `NETWORK` → "Network", `VPN_ACCESS` → "Vpn
 * Access".
 *
 * Used ONLY by the knowledge base, and only because a KB article belongs to no
 * tenant. Everywhere else there is a category row to read a name off, and that
 * name is the one to show — a customer who renames their "Network" to
 * "Networking" means it, and this function would overrule them.
 *
 * The KB cannot do that: one article serves every tenant, so there is no single
 * customer whose name for the subject is the right one to print. Deriving a
 * neutral label from the code is the honest answer — it belongs to nobody, which
 * is exactly what the article does.
 */
/**
 * The categories a brand-new customer starts with.
 *
 * A tenant used to need none of its own: the six shared rows were everybody's,
 * so a customer created five minutes ago already had a full picker. Splitting
 * them per tenant took that away — without this, the first person to raise a
 * ticket for a new customer opens the form and finds an empty category dropdown,
 * and `categoryId` is required, so they cannot file at all.
 *
 * The same six the desk started with, and the same codes, which is what keeps a
 * new tenant's "Network" grouped with everybody else's in a report from its
 * first day.
 *
 * Names only — no default team. A new customer has no teams yet, and pointing at
 * another tenant's would route their work into somebody else's queue.
 * Deliberately a starting point rather than a policy: an administrator renames,
 * adds and removes freely afterwards, and nothing re-applies this list.
 */
export const STARTER_CATEGORY_NAMES = [
  "Network",
  "Email",
  "Hardware",
  "Access",
  "Accounts",
  "Software",
] as const;

export function categoryLabel(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}
