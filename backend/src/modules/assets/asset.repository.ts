import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { assetScopeWhere } from "./asset.scope";
import type { AssetKind, AssetStatus } from "./asset.types";

const assetInclude = {
  owner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AssetInclude;

type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

export type AssetDto = {
  id: number;
  assetTag: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  serial: string | null;
  location: string | null;
  owner: { id: number; name: string; email: string } | null;
  ticketCount: number;
  createdAt: string;
};

function toDto(row: AssetRow, ticketCount = 0): AssetDto {
  return {
    id: row.id,
    assetTag: row.assetTag,
    name: row.name,
    kind: row.kind,
    status: row.status,
    serial: row.serial,
    location: row.location,
    owner: row.owner,
    ticketCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export type AssetWriteInput = {
  assetTag: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  serial?: string | null;
  location?: string | null;
  ownerId?: number | null;
};

/** The only assets layer that talks to the database. */
export const assetRepository = {
  /**
   * Scoped list. `search` matches tag, name, or serial — this powers both the
   * management page and the affected-asset picker on a ticket.
   */
  async findMany(
    actor: AuthUser,
    opts: { search?: string; status?: AssetStatus; limit?: number } = {},
  ): Promise<AssetDto[]> {
    const search = opts.search?.trim();
    const rows = await prisma.asset.findMany({
      where: {
        AND: [
          assetScopeWhere(actor),
          opts.status ? { status: opts.status } : {},
          search
            ? {
                OR: [
                  { assetTag: { contains: search, mode: "insensitive" } },
                  { name: { contains: search, mode: "insensitive" } },
                  { serial: { contains: search, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      include: { ...assetInclude, _count: { select: { tickets: true } } },
      orderBy: [{ assetTag: "asc" }],
      take: opts.limit ?? 200,
    });
    return rows.map((r) => toDto(r, r._count.tickets));
  },

  async findById(id: number, actor: AuthUser): Promise<AssetDto | null> {
    // Out-of-scope assets 404 rather than leak their existence.
    const row = await prisma.asset.findFirst({
      where: { AND: [{ id }, assetScopeWhere(actor)] },
      include: { ...assetInclude, _count: { select: { tickets: true } } },
    });
    return row ? toDto(row, row._count.tickets) : null;
  },

  /**
   * Create in the actor's tenant. A platform admin has no customer of their own,
   * so `customerId` is taken from the explicit argument in that case.
   */
  async create(
    data: AssetWriteInput,
    actor: AuthUser,
    customerId: number | null,
  ): Promise<AssetDto> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          assetTag: data.assetTag,
          name: data.name,
          kind: data.kind,
          status: data.status,
          serial: data.serial ?? null,
          location: data.location ?? null,
          ownerId: data.ownerId ?? null,
          customerId,
        },
        include: assetInclude,
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "asset.create",
          entity: "asset",
          entityId: created.id,
          meta: { assetTag: created.assetTag, name: created.name },
        },
        tx,
      );
      return toDto(created);
    });
  },

  /** Scoped update. Returns null when the asset is outside the actor's scope. */
  async update(
    id: number,
    data: Partial<AssetWriteInput>,
    actor: AuthUser,
  ): Promise<AssetDto | null> {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.asset.findFirst({
        where: { AND: [{ id }, assetScopeWhere(actor)] },
        select: { id: true },
      });
      if (!exists) return null;
      const updated = await tx.asset.update({
        where: { id },
        data: {
          ...(data.assetTag !== undefined ? { assetTag: data.assetTag } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.kind !== undefined ? { kind: data.kind } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.serial !== undefined ? { serial: data.serial } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
        },
        include: { ...assetInclude, _count: { select: { tickets: true } } },
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "asset.update",
          entity: "asset",
          entityId: id,
          meta: data as Prisma.InputJsonValue,
        },
        tx,
      );
      return toDto(updated, updated._count.tickets);
    });
  },

  /**
   * Retire rather than delete — an asset referenced by past tickets must stay
   * resolvable, so this mirrors the "tickets are closed, never deleted" rule.
   */
  async retire(id: number, actor: AuthUser): Promise<AssetDto | null> {
    return this.update(id, { status: "retired" }, actor);
  },

  /** Whether every id is inside the actor's scope — guards ticket linking. */
  async allInScope(ids: number[], actor: AuthUser): Promise<boolean> {
    if (ids.length === 0) return true;
    const count = await prisma.asset.count({
      where: { AND: [{ id: { in: ids } }, assetScopeWhere(actor)] },
    });
    return count === new Set(ids).size;
  },
};
