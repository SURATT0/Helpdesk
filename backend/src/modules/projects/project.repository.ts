import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import type { AssignmentCandidate } from "../tickets/ticket.scope";
import { projectScopeWhere } from "./project.scope";
import type { ProjectRouting } from "./project.routing";

/** Prisma client or an active transaction client. */
type Db = Prisma.TransactionClient | typeof prisma;

const projectInclude = {
  owner: { select: { id: true, name: true, availableForAssignment: true } },
  backupOwner: {
    select: { id: true, name: true, availableForAssignment: true },
  },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** A caseworker slot as the API returns it, with the availability flag exposed
 * so an admin screen can show "owner is away" without a second request. */
export type ProjectOwnerDto = {
  id: number;
  name: string;
  available: boolean;
} | null;

/**
 * What a deletion would disturb: the project's identity, and how many people
 * route through it. `members` counts listed members plus the owner and backup
 * owner, de-duplicated — see `findDeletionImpact`.
 */
export type ProjectDeletionImpact = {
  id: number;
  name: string;
  customerId: number;
  members: number;
};

export type ProjectDto = {
  id: number;
  name: string;
  customerId: number;
  owner: ProjectOwnerDto;
  backupOwner: ProjectOwnerDto;
  members: number;
  createdAt: string;
};

function toOwnerDto(
  row: { id: number; name: string; availableForAssignment: boolean } | null,
): ProjectOwnerDto {
  return row
    ? { id: row.id, name: row.name, available: row.availableForAssignment }
    : null;
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    customerId: row.customerId,
    owner: toOwnerDto(row.owner),
    backupOwner: toOwnerDto(row.backupOwner),
    members: row._count.members,
    createdAt: row.createdAt.toISOString(),
  };
}

export const projectRepository = {
  async findMany(actor: AuthUser): Promise<ProjectDto[]> {
    const rows = await prisma.project.findMany({
      where: projectScopeWhere(actor),
      include: projectInclude,
      orderBy: { name: "asc" },
    });
    return rows.map(toDto);
  },

  async findById(id: number, actor: AuthUser): Promise<ProjectDto | null> {
    // findFirst + scope: an out-of-scope project reads as "not found" rather
    // than leaking that another tenant has one.
    const row = await prisma.project.findFirst({
      where: { AND: [{ id }, projectScopeWhere(actor)] },
      include: projectInclude,
    });
    return row ? toDto(row) : null;
  },

  /**
   * A prospective owner's role and tenant, for `mayReceiveAssignment`. Reuses the
   * ticket module's rule deliberately: being a project's owner means being handed
   * that project's tickets, so the two must not drift apart.
   */
  async findOwnerCandidate(userId: number): Promise<AssignmentCandidate | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, customerId: true, isActive: true },
    });
  },

  /**
   * The routing facts for a requester's project: who owns it, who backs the owner
   * up, and whether each is currently accepting work. Null when the requester
   * belongs to no project — in which case nothing is routed and the ticket stays
   * unassigned, as it did before projects existed.
   *
   * Takes a `Db` so ticket creation can read it inside its own transaction,
   * matching auditRepository.record.
   */
  async findRoutingForRequester(
    requesterId: number,
    db: Db = prisma,
  ): Promise<ProjectRouting | null> {
    const row = await db.user.findUnique({
      where: { id: requesterId },
      select: {
        project: {
          select: {
            ownerId: true,
            owner: {
              select: { availableForAssignment: true, isActive: true },
            },
            backupOwnerId: true,
            backupOwner: {
              select: { availableForAssignment: true, isActive: true },
            },
          },
        },
      },
    });
    const project = row?.project;
    if (!project) return null;
    /**
     * "Available" here means both switches: on the rota AND still employed. A
     * closed account would otherwise keep collecting a project's incoming tickets
     * — the one place routing happens without anyone choosing a name.
     *
     * Widened here rather than in `resolveRoutedAssignee`, which stays a pure
     * function over "is this slot available"; what fills that word belongs with
     * the query that reads it.
     */
    const usable = (u: { availableForAssignment: boolean; isActive: boolean } | null) =>
      (u?.availableForAssignment ?? false) && (u?.isActive ?? false);
    return {
      ownerId: project.ownerId,
      // An empty slot is not available — resolveRoutedAssignee also guards on the
      // id, so this only has to be non-true.
      ownerAvailable: usable(project.owner),
      backupOwnerId: project.backupOwnerId,
      backupOwnerAvailable: usable(project.backupOwner),
    };
  },

  async create(
    data: {
      name: string;
      customerId: number;
      ownerId?: number | null;
      backupOwnerId?: number | null;
    },
    actorId: number,
  ): Promise<ProjectDto> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: data.name,
          customerId: data.customerId,
          ownerId: data.ownerId ?? null,
          backupOwnerId: data.backupOwnerId ?? null,
        },
        include: projectInclude,
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "project.create",
          entity: "project",
          entityId: created.id,
          meta: {
            name: data.name,
            customerId: data.customerId,
            ownerId: data.ownerId ?? null,
            backupOwnerId: data.backupOwnerId ?? null,
          },
        },
        tx,
      );
      return toDto(created);
    });
  },

  async update(
    id: number,
    data: {
      name?: string;
      ownerId?: number | null;
      backupOwnerId?: number | null;
    },
    actor: AuthUser,
  ): Promise<ProjectDto | null> {
    return prisma.$transaction(async (tx) => {
      // Scope-checked inside the transaction, so a concurrent tenant change
      // can't slip an out-of-scope project past the check.
      const exists = await tx.project.findFirst({
        where: { AND: [{ id }, projectScopeWhere(actor)] },
        select: { id: true },
      });
      if (!exists) return null;

      const updated = await tx.project.update({
        where: { id },
        data,
        include: projectInclude,
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "project.update",
          entity: "project",
          entityId: id,
          meta: {
            name: data.name,
            ownerId: data.ownerId,
            backupOwnerId: data.backupOwnerId,
          },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  /**
   * What deleting this project would disturb, for the confirmation dialog and
   * for the guard behind it — both read this, so the number a person is shown is
   * the number the server refuses on.
   *
   * "Members" is everyone the project is pointed at: its listed members plus the
   * owner and backup owner, who route work through it without necessarily
   * belonging to it. Scoped, so an out-of-scope id reads as "not found".
   */
  async findDeletionImpact(
    id: number,
    actor: AuthUser,
  ): Promise<ProjectDeletionImpact | null> {
    const row = await prisma.project.findFirst({
      where: { AND: [{ id }, projectScopeWhere(actor)] },
      select: {
        id: true,
        name: true,
        customerId: true,
        ownerId: true,
        backupOwnerId: true,
        _count: { select: { members: true } },
      },
    });
    if (!row) return null;
    // Owner and backup are counted only when they are not already listed as
    // members, which `_count` cannot express — so they are added as distinct
    // ids rather than incremented blindly.
    const extra = new Set<number>();
    if (row.ownerId != null) extra.add(row.ownerId);
    if (row.backupOwnerId != null) extra.add(row.backupOwnerId);
    const alsoMembers = extra.size
      ? await prisma.user.count({
          where: { id: { in: [...extra] }, projectId: id },
        })
      : 0;
    return {
      id: row.id,
      name: row.name,
      customerId: row.customerId,
      members: row._count.members + extra.size - alsoMembers,
    };
  },

  /**
   * Soft-delete: stamp `deletedAt`/`deletedById` and write the trail.
   *
   * An UPDATE rather than a DELETE, so the audit row's `entityId` still resolves
   * to something and the routing history stays readable. `projectScopeWhere`
   * hides it from every read afterwards, membership included.
   *
   * Re-checked inside the transaction like `update` above: the impact count the
   * caller validated was read outside it, so a member added in between must not
   * slip through. `members: { none: {} }` is that check, expressed as part of the
   * same statement that does the write — a second read could still race it.
   */
  async softDelete(
    id: number,
    actor: AuthUser,
    snapshot: { name: string; customerId: number; members: number },
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.project.updateMany({
        where: {
          AND: [
            { id },
            projectScopeWhere(actor),
            { members: { none: {} }, ownerId: null, backupOwnerId: null },
          ],
        },
        data: { deletedAt: new Date(), deletedById: actor.id },
      });
      if (claimed.count === 0) return false;

      await auditRepository.record(
        {
          userId: actor.id,
          action: "project.delete",
          entity: "project",
          entityId: id,
          // Denormalised on purpose. `audit_logs.entityId` is a plain integer
          // with no foreign key, so nothing stops the row being deleted out from
          // under it — but nothing resolves the id back to a name either. The
          // trail has to be readable on its own years later.
          meta: {
            name: snapshot.name,
            customerId: snapshot.customerId,
            members: snapshot.members,
            actorRole: actor.role,
          },
        },
        tx,
      );
      return true;
    });
  },
};
