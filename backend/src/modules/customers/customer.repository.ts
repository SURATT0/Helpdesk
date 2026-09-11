import { Prisma } from "@prisma/client";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import {
  categoryCode,
  STARTER_CATEGORY_NAMES,
} from "../categories/category.code";

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
 *
 * Archived customers are invisible to EVERYONE, platform-wide reach included —
 * folded in here rather than added at each call site, exactly as
 * `projectScopeWhere` does it. A picker that still offered an archived tenant
 * would let someone file new work into a company the desk has finished with.
 */
export function customerScopeWhere(actor: AuthUser): Prisma.CustomerWhereInput {
  return { deletedAt: null, ...reachWhere(actor) };
}

function reachWhere(actor: AuthUser): Prisma.CustomerWhereInput {
  if (isPlatformWide(actor)) return {};
  const reach = customerReach(actor);
  if (reach.length === 0) return { id: -1 };
  return { id: { in: reach } };
}

export type CustomerDto = {
  id: number;
  name: string;
  /**
   * What is live under this tenant right now. Read by the archive dialog so the
   * number a person is shown is the number the guard refuses on, and by the list
   * so "empty" is visible before anyone tries.
   */
  counts: { projects: number; tickets: number; users: number };
  createdAt: string;
};

/** What archiving would be refused for. Also the dialog's warning. */
export type CustomerArchiveImpact = {
  id: number;
  name: string;
  projects: number;
  tickets: number;
  users: number;
};

/**
 * Live projects, OPEN tickets and active users, per customer.
 *
 * Open tickets rather than all of them, deliberately: a tenant whose work is
 * finished is exactly the one you archive, and counting closed tickets would
 * make that impossible forever. Live/active on the other two for the same
 * reason — an archived project or a closed account is not a thing to move.
 */
async function countsFor(ids: number[]): Promise<Map<number, CustomerDto["counts"]>> {
  const empty = () => ({ projects: 0, tickets: 0, users: 0 });
  const out = new Map(ids.map((id) => [id, empty()]));
  if (ids.length === 0) return out;

  const [projects, tickets, users] = await Promise.all([
    prisma.project.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: ids },
        deletedAt: null,
        status: { not: "closed" },
      },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids }, isActive: true },
      _count: { _all: true },
    }),
  ]);

  for (const r of projects) {
    const c = out.get(r.customerId);
    if (c) c.projects = r._count._all;
  }
  for (const r of tickets) {
    const c = out.get(r.customerId);
    if (c) c.tickets = r._count._all;
  }
  for (const r of users) {
    if (r.customerId == null) continue;
    const c = out.get(r.customerId);
    if (c) c.users = r._count._all;
  }
  return out;
}

export const customerRepository = {
  async findMany(actor: AuthUser): Promise<CustomerDto[]> {
    const rows = await prisma.customer.findMany({
      where: customerScopeWhere(actor),
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    // One grouped query per relation for the whole page rather than three per
    // row: the list is short today and this keeps it short-lived when it is not.
    const counts = await countsFor(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      counts: counts.get(r.id) ?? { projects: 0, tickets: 0, users: 0 },
      createdAt: r.createdAt.toISOString(),
    }));
  },

  async findById(id: number, actor: AuthUser): Promise<CustomerDto | null> {
    const row = await prisma.customer.findFirst({
      where: { AND: [{ id }, customerScopeWhere(actor)] },
      select: { id: true, name: true, createdAt: true },
    });
    if (!row) return null;
    const counts = await countsFor([row.id]);
    return {
      id: row.id,
      name: row.name,
      counts: counts.get(row.id) ?? { projects: 0, tickets: 0, users: 0 },
      createdAt: row.createdAt.toISOString(),
    };
  },

  /**
   * Is that name already taken, archived rows included?
   *
   * Archived ones count, unlike projects: two companies sharing a name in the
   * audit trail is the thing customer names exist to prevent. Answered here so
   * the service can say "that name is an archived customer — revive it" instead
   * of letting a unique violation surface as a 500.
   */
  async findByName(name: string): Promise<{ id: number; deletedAt: Date | null } | null> {
    return prisma.customer.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true, deletedAt: true },
    });
  },

  async create(name: string, actor: AuthUser): Promise<CustomerDto> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: { name } });

      // The starter category set, in the SAME transaction as the customer.
      //
      // Not a nicety. `tickets.category_id` is required and every category now
      // belongs to a tenant, so a customer with none has a create-ticket form
      // whose dropdown is empty and whose submit can never succeed. Creating the
      // tenant and the rows that make it usable is one act, and a customer that
      // existed for a moment without them would be a broken tenant somebody
      // could be filing against.
      await tx.category.createMany({
        data: STARTER_CATEGORY_NAMES.map((categoryName) => ({
          name: categoryName,
          code: categoryCode(categoryName),
          customerId: created.id,
        })),
      });

      await auditRepository.record(
        {
          userId: actor.id,
          action: "customer.create",
          entity: "customer",
          entityId: created.id,
          meta: { name },
        },
        tx,
      );
      return {
        id: created.id,
        name: created.name,
        counts: { projects: 0, tickets: 0, users: 0 },
        createdAt: created.createdAt.toISOString(),
      };
    });
  },

  async rename(
    id: number,
    name: string,
    actor: AuthUser,
  ): Promise<CustomerDto | null> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { AND: [{ id }, customerScopeWhere(actor)] },
        select: { id: true, name: true },
      });
      if (!existing) return null;
      const updated = await tx.customer.update({ where: { id }, data: { name } });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "customer.rename",
          entity: "customer",
          entityId: id,
          // Both names: a rename is only legible in the trail if you can see
          // what it was called before.
          meta: { from: existing.name, to: name },
        },
        tx,
      );
      const counts = await countsFor([id]);
      return {
        id: updated.id,
        name: updated.name,
        counts: counts.get(id) ?? { projects: 0, tickets: 0, users: 0 },
        createdAt: updated.createdAt.toISOString(),
      };
    });
  },

  async findArchiveImpact(
    id: number,
    actor: AuthUser,
  ): Promise<CustomerArchiveImpact | null> {
    const row = await prisma.customer.findFirst({
      where: { AND: [{ id }, customerScopeWhere(actor)] },
      select: { id: true, name: true },
    });
    if (!row) return null;
    const counts = (await countsFor([id])).get(id) ?? {
      projects: 0,
      tickets: 0,
      users: 0,
    };
    return { id: row.id, name: row.name, ...counts };
  },

  /**
   * Archive, guarded by a re-count INSIDE the transaction.
   *
   * The caller has already read the impact and refused on it; this reads it
   * again because between those two moments somebody can raise a ticket. The
   * guarded write is what makes the check meaningful rather than advisory —
   * same shape as the project soft delete.
   *
   * Returns false when the re-count no longer agrees, which the service reports
   * as the same 409.
   */
  async archive(id: number, actor: AuthUser): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const [projects, tickets, users] = await Promise.all([
        tx.project.count({ where: { customerId: id, deletedAt: null } }),
        tx.ticket.count({
          where: { customerId: id, deletedAt: null, status: { not: "closed" } },
        }),
        tx.user.count({ where: { customerId: id, isActive: true } }),
      ]);
      if (projects > 0 || tickets > 0 || users > 0) return false;

      const done = await tx.customer.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.id },
      });
      if (done.count === 0) return false;

      await auditRepository.record(
        {
          userId: actor.id,
          action: "customer.archive",
          entity: "customer",
          entityId: id,
          meta: {},
        },
        tx,
      );
      return true;
    });
  },
};
