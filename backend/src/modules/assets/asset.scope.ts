import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";

/**
 * Row-level asset visibility as a Prisma where-clause — the single source of
 * truth for "which assets can this user see", mirroring `ticketScopeWhere`.
 *
 * Multi-tenant: the customer is the isolation boundary.
 *   admin (customerId null) → every asset, all customers;
 *   everyone else           → assets of their own customer.
 * A non-admin without a customer matches nothing (defensive — shouldn't happen
 * for seeded users).
 */
export function assetScopeWhere(user: AuthUser): Prisma.AssetWhereInput {
  if (user.role === "admin") return {};
  if (user.customerId == null) return { id: -1 };
  return { customerId: user.customerId };
}
