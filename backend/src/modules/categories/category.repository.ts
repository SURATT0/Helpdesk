import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { prisma } from "../../shared/db";

export type Category = {
  id: number;
  name: string;
  /** The cross-tenant identity behind the name. See Category.code. */
  code: string;
  defaultTeamId: number | null;
  /** The tenant this category belongs to. Every category belongs to one. */
  customerId: number;
};

/**
 * Which categories this principal may see.
 *
 * Now the same shape as every other scope builder, and that is the change worth
 * noticing. It used to be an OR, because a category could belong to nobody —
 * `customer_id IS NULL` meant shared with everyone, so the clause had to reach
 * both the shared rows and the caller's own. There are no shared rows any more:
 * each tenant owns its own copy, and what crosses tenants is `code`, which is a
 * grouping key rather than a row anybody can see through.
 *
 * So an empty reach is now the "match nothing" sentinel it is everywhere else.
 * That is not a regression in what platform staff can see — `isPlatformWide`
 * still returns everything above — it is the removal of the one arm that let a
 * principal with no reach at all see rows regardless.
 */
export function categoryScopeWhere(actor: AuthUser): Prisma.CategoryWhereInput {
  if (isPlatformWide(actor)) return {};
  const reach = customerReach(actor);
  // Deliberately impossible rather than `{}`: an empty reach must match no
  // category, and an empty where-clause would match every one of them.
  if (reach.length === 0) return { id: { in: [] } };
  return { customerId: { in: reach } };
}

const CATEGORY_SELECT = {
  id: true,
  name: true,
  code: true,
  defaultTeamId: true,
  customerId: true,
} as const;

/** The only categories layer that talks to the database. */
export const categoryRepository = {
  findMany(actor: AuthUser): Promise<Category[]> {
    return prisma.category.findMany({
      where: categoryScopeWhere(actor),
      // By customer, then by name. The customer ordering used to separate the
      // shared rows from a tenant's own; it now groups a cross-tenant reader's
      // list by whose categories they are, which is the same reason — a picker
      // that interleaved two customers' "Network" by name alone would not say
      // which was which.
      orderBy: [{ customerId: "asc" }, { name: "asc" }],
      select: CATEGORY_SELECT,
    });
  },

  /**
   * One category, subject to the caller's reach.
   *
   * Scoped, unlike the `findUnique` it replaces. An unscoped lookup by id is how
   * a caller learns that another tenant's category exists — and worse, it was
   * the value the ticket writer used to validate against, so an unreachable
   * category read as valid.
   */
  findById(actor: AuthUser, id: number): Promise<Category | null> {
    return prisma.category.findFirst({
      where: { AND: [{ id }, categoryScopeWhere(actor)] },
      select: CATEGORY_SELECT,
    });
  },
};
