import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { prisma } from "../../shared/db";

/**
 * Row-level customer visibility, the same shape as every other scope builder:
 * a platform-wide principal sees every tenant, everyone else sees the ones they
 * reach — normally just their own — and someone who reaches none matches
 * nothing.
 *
 * Note this is the LIST of tenants, not their contents, and it is what a picker
 * is filled from. Keeping it on reach rather than on a permission is what stops
 * an admin who may create a customer from using the picker to enumerate the
 * tenants they cannot see.
 */
export function customerScopeWhere(actor: AuthUser): Prisma.CustomerWhereInput {
  if (isPlatformWide(actor)) return {};
  const reach = customerReach(actor);
  if (reach.length === 0) return { id: -1 };
  return { id: { in: reach } };
}

export type CustomerDto = {
  id: number;
  name: string;
};

export const customerRepository = {
  async findMany(actor: AuthUser): Promise<CustomerDto[]> {
    return prisma.customer.findMany({
      where: customerScopeWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  },
};
