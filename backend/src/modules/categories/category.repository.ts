import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { prisma } from "../../shared/db";
import { OTHER_CATEGORY_CODE } from "../../shared/category-other";
import { auditRepository } from "../audit/audit.repository";

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

/**
 * One description somebody typed under "Other", with how often it has come up.
 *
 * Grouped by the text itself so a theme is visible: five tickets all saying
 * "printer jams" is the signal that this deserves a category, and five separate
 * rows saying it once each is not a signal at all.
 */
export type OtherDescription = {
  /** The text, exactly as it was typed. Grouping is case-insensitive; this is one
   *  of the spellings that fell into the group, the most recent one. */
  text: string;
  count: number;
  customerId: number;
  customerName: string;
  /** So the reader can open one and see the whole ticket behind the phrase. */
  ticketIds: number[];
  lastUsedAt: string;
};

/**
 * What people have been filing under "Other".
 *
 * Grouped case- and space-insensitively, because "Printer jams", "printer jams"
 * and "printer  jams" are one theme and showing them as three defeats the point
 * of the page. The text SHOWN is the most recent spelling rather than a
 * normalised one — the reader is deciding what to name a category, and a
 * lower-cased, squashed version of what someone wrote is a worse starting point
 * than their own words.
 *
 * Raw SQL because this is an aggregate over an expression, which Prisma's
 * `groupBy` cannot express. Every value is parameterised; nothing is
 * interpolated.
 */
export async function findOtherDescriptions(
  actor: AuthUser,
  filter: { customerId?: number; limit: number },
): Promise<OtherDescription[]> {
  const reach = isPlatformWide(actor) ? null : customerReach(actor);
  // Scope first, exactly as every other read does. A platform-wide actor gets
  // every tenant; anyone else gets theirs, and an empty reach gets nothing.
  if (reach != null && reach.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      text: string;
      count: bigint;
      customer_id: number;
      customer_name: string;
      ticket_ids: number[];
      last_used_at: Date;
    }>
  >`
    SELECT
      (array_agg(t."category_other" ORDER BY t."created_at" DESC))[1] AS text,
      COUNT(*) AS count,
      t."customer_id" AS customer_id,
      cu."name" AS customer_name,
      (array_agg(t."id" ORDER BY t."created_at" DESC))[1:20] AS ticket_ids,
      MAX(t."created_at") AS last_used_at
    FROM "tickets" t
    JOIN "categories" cat ON cat."id" = t."category_id"
    JOIN "customers" cu ON cu."id" = t."customer_id"
    WHERE cat."code" = ${OTHER_CATEGORY_CODE}
      AND t."category_other" IS NOT NULL
      AND t."deleted_at" IS NULL
      AND (${filter.customerId ?? null}::int IS NULL OR t."customer_id" = ${filter.customerId ?? null}::int)
      AND (${reach == null}::boolean OR t."customer_id" = ANY(${reach ?? []}::int[]))
    -- Case- and space-insensitive, so "Printer jams" and "printer  jams" are one
    -- theme rather than two rows. The backslash is DOUBLED because this is a
    -- JavaScript template literal, where a lone \s evaluates to a bare "s" —
    -- which would have grouped on runs of that letter and looked almost right.
    GROUP BY t."customer_id", cu."name", lower(regexp_replace(btrim(t."category_other"), '\\s+', ' ', 'g'))
    ORDER BY COUNT(*) DESC, MAX(t."created_at") DESC
    LIMIT ${filter.limit}
  `;

  return rows.map((r) => ({
    text: r.text,
    // `COUNT(*)` comes back as a bigint, which does not survive JSON.
    count: Number(r.count),
    customerId: r.customer_id,
    customerName: r.customer_name,
    ticketIds: r.ticket_ids,
    lastUsedAt: r.last_used_at.toISOString(),
  }));
}

/**
 * Create a category for a customer.
 *
 * Audited like every other mutation, and the audit names the customer as well
 * as the category: "a category was created" is not a useful line in a trail that
 * spans every tenant.
 */
export async function createCategory(
  actor: AuthUser,
  input: { name: string; code: string; customerId: number },
): Promise<Category> {
  const created = await prisma.category.create({
    data: {
      name: input.name,
      code: input.code,
      customerId: input.customerId,
    },
    select: CATEGORY_SELECT,
  });
  await auditRepository.record({
    userId: actor.id,
    action: "category.created",
    entity: "category",
    entityId: created.id,
    meta: {
      name: created.name,
      code: created.code,
      customerId: created.customerId,
    },
  });
  return created;
}
