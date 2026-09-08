import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";

/**
 * Row-level asset visibility as a Prisma where-clause — the single source of
 * truth for "which assets can this user see", mirroring `ticketScopeWhere`.
 *
 * Multi-tenant: the customer is the isolation boundary.
 *   platform-wide → every asset, all customers;
 *   everyone else → assets of every customer they reach, normally just their own.
 * Someone who reaches no customer matches nothing (defensive — shouldn't happen
 * for seeded users).
 */
export function assetScopeWhere(user: AuthUser): Prisma.AssetWhereInput {
  if (isPlatformWide(user)) return {};
  const reach = customerReach(user);
  if (reach.length === 0) return { id: -1 };
  return { customerId: { in: reach } };
}
