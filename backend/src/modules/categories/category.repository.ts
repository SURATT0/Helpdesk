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
  defaultTeamId: number | null;
  /** Null = shared with every customer; a value confines it to that tenant. */
  customerId: number | null;
};

/**
 * Which categories this principal may see.
 *
 * Not the same shape as the other scope builders, because a category has two
 * ways of being reachable: the SHARED ones (`customer_id IS NULL`) belong to
 * nobody and are everybody's, and a tenant's own belong to them. So this is an
 * OR, where `ticketScopeWhere` and friends are a plain tenant filter.
 *
 * The shared arm is why an empty reach is not the "match nothing" sentinel the
 * others use: someone with no customer still legitimately sees the shared list,
 * and a picker that showed them nothing would make the ticket form unusable for
 * platform staff filing on someone's behalf.
 */
export function categoryScopeWhere(actor: AuthUser): Prisma.CategoryWhereInput {
  if (isPlatformWide(actor)) return {};
  const reach = customerReach(actor);
  if (reach.length === 0) return { customerId: null };
  return { OR: [{ customerId: null }, { customerId: { in: reach } }] };
}

/** The only categories layer that talks to the database. */
export const categoryRepository = {
  findMany(actor: AuthUser): Promise<Category[]> {
    return prisma.category.findMany({
      where: categoryScopeWhere(actor),
      // Shared first, then the customer's own, each alphabetically: the list is
      // read as "the standard ones, and ours", and interleaving them by name
      // alone would hide which is which.
      orderBy: [{ customerId: "asc" }, { name: "asc" }],
      select: { id: true, name: true, defaultTeamId: true, customerId: true },
    });
  },

  findById(id: number) {
    return prisma.category.findUnique({ where: { id } });
  },
};
