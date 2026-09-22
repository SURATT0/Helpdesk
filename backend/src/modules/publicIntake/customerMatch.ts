import type { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Which customer, if any, a submission's business email belongs to.
 *
 * Compares the domain against `Customer.domains` (added alongside this
 * module — the design doc names this match but never says where the "domains
 * registered to a customer" it compares against actually live). Exact,
 * case-insensitive match on the whole domain; no subdomain or wildcard
 * matching, so `mail.acme.co.th` does not match a `domains` entry of
 * `acme.co.th` — a tenant that wants both lists both.
 *
 * Excludes the system tenant itself (`isSystemTenant`) as a defensive measure
 * only: it starts with an empty `domains` array and nothing in the app should
 * ever add one, but a match landing a real submission on the placeholder
 * tenant BY COINCIDENCE would be worse than one extra WHERE clause.
 */
export async function matchCustomerByDomain(
  tx: Tx,
  businessEmail: string,
): Promise<{ id: number; name: string } | null> {
  const domain = businessEmail.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;

  return tx.customer.findFirst({
    where: {
      domains: { has: domain },
      isSystemTenant: false,
      deletedAt: null,
    },
    select: { id: true, name: true },
  });
}
