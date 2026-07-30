import { Prisma } from "@prisma/client";
import type { Priority, TicketStatus } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { BadRequest } from "../../shared/errors";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { notificationRepository } from "../notifications/notification.repository";
import { computeDueAt, deriveSla, type SlaState } from "./sla";
import { ticketScopeWhere } from "./ticket.scope";

/** Recipients for a ticket event: requester + assignee, minus the actor. */
function recipientsFor(
  ticket: { requesterId: number; assigneeId: number | null },
  actorId: number | null | undefined,
  exclude: number[] = [],
): number[] {
  const ids = [ticket.requesterId, ticket.assigneeId].filter(
    (x): x is number =>
      x != null && x !== actorId && !exclude.includes(x),
  );
  return [...new Set(ids)];
}

export type { SlaState };

/**
 * API/DTO shape returned to callers (unchanged across the Prisma cutover). The
 * normalized columns (requester/assignee/category FKs) are joined into display
 * names here, and `slaDue`/`slaState` are derived — see ./sla. This repository
 * is the ONLY ticket-module layer that talks to the database; the service
 * depends on this shape, never on Prisma.
 */
export type Ticket = {
  id: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  requester: string;
  requesterEmail: string;
  assignee: string | null;
  category: string;
  slaDue: string;
  slaState: SlaState;
  /**
   * The SLA target itself, so the client can tick a live countdown instead of
   * re-fetching for a fresh `slaDue` string. `slaDue`/`slaState` remain the
   * server's authoritative snapshot at response time.
   */
  dueAt: string | null;
  resolvedAt: string | null;
  attachments: number;
  /**
   * Who and what this ticket is about, as opposed to who reported it. Both are
   * optional and manually maintained — nothing is inferred from the session.
   */
  affectedUsers: { id: number; name: string; email: string }[];
  affectedAssets: {
    id: number;
    assetTag: string;
    name: string;
    kind: string;
    status: string;
  }[];
  problem: { id: number; title: string; status: string } | null;
  createdAt: string;
  closedAt: string | null;
};

export type TicketFilter = {
  status?: TicketStatus;
  priority?: Priority;
};

export type HistoryEntry = {
  id: number;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  actor: string | null;
  createdAt: string;
};

export type CreateTicketInput = {
  subject: string;
  description: string;
  categoryId: number;
  priority: Priority;
  requesterId: number;
  /**
   * Who performed the creation, for history/audit. Defaults to the requester
   * (self-service). On CSV import the importer differs from the requester.
   */
  actorId?: number;
};

const ticketInclude = {
  requester: true,
  assignee: true,
  category: true,
  problem: { select: { id: true, title: true, status: true } },
  affectedUsers: {
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  },
  affectedAssets: {
    select: {
      asset: {
        select: {
          id: true,
          assetTag: true,
          name: true,
          kind: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

function toTicketDto(row: TicketRow): Ticket {
  const { slaDue, slaState } = deriveSla(
    row.status,
    row.dueAt,
    new Date(),
    row.resolvedAt,
  );
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    priority: row.priority,
    requester: row.requester.name,
    requesterEmail: row.requester.email,
    assignee: row.assignee?.name ?? null,
    category: row.category.name,
    slaDue,
    slaState,
    dueAt: row.dueAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    attachments: row._count.attachments,
    affectedUsers: row.affectedUsers.map((a) => a.user),
    affectedAssets: row.affectedAssets.map((a) => a.asset),
    problem: row.problem,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

export const ticketRepository = {
  async findMany(filter: TicketFilter, user: AuthUser): Promise<Ticket[]> {
    const rows = await prisma.ticket.findMany({
      where: {
        AND: [
          ticketScopeWhere(user),
          {
            ...(filter.status ? { status: filter.status } : {}),
            ...(filter.priority ? { priority: filter.priority } : {}),
          },
        ],
      },
      include: ticketInclude,
      orderBy: { dueAt: "asc" },
    });
    return rows.map(toTicketDto);
  },

  async findHistory(ticketId: number): Promise<HistoryEntry[]> {
    const rows = await prisma.ticketStatusHistory.findMany({
      where: { ticketId },
      include: { changedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      actor: r.changedBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  },

  /** Ids of tickets still in `resolved` whose resolution is older than the cutoff. */
  async findStaleResolved(cutoff: Date): Promise<number[]> {
    const rows = await prisma.ticket.findMany({
      where: { status: "resolved", resolvedAt: { lte: cutoff } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  async findById(id: number, user: AuthUser): Promise<Ticket | null> {
    // findFirst (not findUnique): the scope clause narrows the lookup, so an
    // out-of-scope ticket reads as "not found" rather than leaking existence.
    const row = await prisma.ticket.findFirst({
      where: { AND: [{ id }, ticketScopeWhere(user)] },
      include: ticketInclude,
    });
    return row ? toTicketDto(row) : null;
  },

  async create(input: CreateTicketInput): Promise<Ticket> {
    const actorId = input.actorId ?? input.requesterId;
    return prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({
        where: { id: input.categoryId },
      });
      if (!category) throw BadRequest("Unknown category");

      // A ticket belongs to its requester's customer (the tenant boundary).
      const requester = await tx.user.findUnique({
        where: { id: input.requesterId },
        select: { customerId: true },
      });

      const now = new Date();
      const created = await tx.ticket.create({
        data: {
          subject: input.subject,
          description: input.description,
          status: "new",
          priority: input.priority,
          requesterId: input.requesterId,
          customerId: requester?.customerId ?? null,
          // Auto-assignment: unassigned tickets are routed to the category's
          // default team queue implicitly (via the repository scope), so we set
          // no assignee here.
          categoryId: input.categoryId,
          dueAt: computeDueAt(input.priority, now),
          createdAt: now,
        },
        include: ticketInclude,
      });

      await tx.ticketStatusHistory.create({
        data: { ticketId: created.id, fromStatus: null, toStatus: "new", changedById: actorId },
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "ticket.create",
          entity: "ticket",
          entityId: created.id,
          meta: {
            priority: input.priority,
            categoryId: input.categoryId,
            ...(input.actorId && input.actorId !== input.requesterId
              ? { via: "import", requesterId: input.requesterId }
              : {}),
          },
        },
        tx,
      );

      return toTicketDto(created);
    });
  },

  /** Resolve a category name to its id (case-insensitive). Null if unknown. */
  async findCategoryIdByName(name: string): Promise<number | null> {
    const row = await prisma.category.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  /** Resolve a requester email to its user id (case-insensitive). Null if unknown. */
  async findUserIdByEmail(email: string): Promise<number | null> {
    const row = await prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  async updateAssignee(
    id: number,
    assigneeId: number | null,
    changedById?: number,
  ): Promise<Ticket | null> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) return null;
      if (assigneeId != null) {
        const assignee = await tx.user.findUnique({ where: { id: assigneeId } });
        if (!assignee) throw BadRequest("Unknown assignee");
      }

      const updated = await tx.ticket.update({
        where: { id },
        data: { assigneeId },
        include: ticketInclude,
      });

      if (current.assigneeId !== assigneeId) {
        await auditRepository.record(
          {
            userId: changedById ?? null,
            action: "ticket.assign",
            entity: "ticket",
            entityId: id,
            meta: { from: current.assigneeId, to: assigneeId },
          },
          tx,
        );
        await notificationRepository.createMany(
          recipientsFor(
            { requesterId: current.requesterId, assigneeId },
            changedById,
          ).map((userId) => ({
            userId,
            type: "ticket.assigned",
            ticketId: id,
            message: `Ticket #${id} was reassigned`,
          })),
          tx,
        );
      }

      return toTicketDto(updated);
    });
  },

  async updatePriority(
    id: number,
    priority: Priority,
    changedById?: number,
  ): Promise<Ticket | null> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) return null;

      const updated = await tx.ticket.update({
        where: { id },
        data: {
          priority,
          // Re-derive the SLA target for the new priority off the original
          // creation time so slaDue stays meaningful after a re-prioritise.
          dueAt: computeDueAt(priority, current.createdAt),
        },
        include: ticketInclude,
      });

      if (current.priority !== priority) {
        await auditRepository.record(
          {
            userId: changedById ?? null,
            action: "ticket.priority_change",
            entity: "ticket",
            entityId: id,
            meta: { from: current.priority, to: priority },
          },
          tx,
        );
      }

      return toTicketDto(updated);
    });
  },

  async updateStatus(
    id: number,
    status: TicketStatus,
    changedById?: number,
  ): Promise<Ticket | null> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) return null;

      const updated = await tx.ticket.update({
        where: { id },
        data: {
          status,
          ...(status === "resolved" ? { resolvedAt: new Date() } : {}),
          ...(status === "closed" ? { closedAt: new Date() } : {}),
        },
        include: ticketInclude,
      });

      // Append the SLA source-of-truth row + audit (skip pure no-op changes).
      if (current.status !== status) {
        await tx.ticketStatusHistory.create({
          data: {
            ticketId: id,
            fromStatus: current.status,
            toStatus: status,
            changedById: changedById ?? null,
          },
        });
        await auditRepository.record(
          {
            userId: changedById ?? null,
            action: "ticket.status_change",
            entity: "ticket",
            entityId: id,
            meta: { from: current.status, to: status },
          },
          tx,
        );
        await notificationRepository.createMany(
          recipientsFor(current, changedById).map((userId) => ({
            userId,
            type: "ticket.status_change",
            ticketId: id,
            message: `Ticket #${id} moved to ${status.replace("_", " ")}`,
          })),
          tx,
        );
      }

      return toTicketDto(updated);
    });
  },

  /**
   * Replace the set of affected users on a ticket. Scoped: the ticket must be
   * visible to the actor, and every user id must belong to the ticket's own
   * customer — otherwise this endpoint would leak (and attach) users from
   * another tenant. Returns null when the ticket is out of scope.
   */
  async setAffectedUsers(
    id: number,
    userIds: number[],
    actor: AuthUser,
  ): Promise<Ticket | null> {
    const ids = [...new Set(userIds)];
    return prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { AND: [{ id }, ticketScopeWhere(actor)] },
        select: { id: true, customerId: true },
      });
      if (!ticket) return null;

      if (ids.length > 0) {
        // Same-tenant check. A platform-wide ticket (customerId null) accepts
        // only platform-wide users, by the same rule.
        const valid = await tx.user.count({
          where: { id: { in: ids }, customerId: ticket.customerId },
        });
        if (valid !== ids.length) {
          throw BadRequest("Affected users must belong to the ticket's customer");
        }
      }

      await tx.ticketAffectedUser.deleteMany({ where: { ticketId: id } });
      if (ids.length > 0) {
        await tx.ticketAffectedUser.createMany({
          data: ids.map((userId) => ({ ticketId: id, userId })),
        });
      }
      await auditRepository.record(
        {
          userId: actor.id,
          action: "ticket.set_affected_users",
          entity: "ticket",
          entityId: id,
          meta: { userIds: ids },
        },
        tx,
      );

      const updated = await tx.ticket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
      return toTicketDto(updated);
    });
  },

  /**
   * Replace the set of affected assets on a ticket. Same tenant rule as
   * `setAffectedUsers`. Returns null when the ticket is out of scope.
   */
  async setAffectedAssets(
    id: number,
    assetIds: number[],
    actor: AuthUser,
  ): Promise<Ticket | null> {
    const ids = [...new Set(assetIds)];
    return prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { AND: [{ id }, ticketScopeWhere(actor)] },
        select: { id: true, customerId: true },
      });
      if (!ticket) return null;

      if (ids.length > 0) {
        const valid = await tx.asset.count({
          where: { id: { in: ids }, customerId: ticket.customerId },
        });
        if (valid !== ids.length) {
          throw BadRequest("Affected assets must belong to the ticket's customer");
        }
      }

      await tx.ticketAffectedAsset.deleteMany({ where: { ticketId: id } });
      if (ids.length > 0) {
        await tx.ticketAffectedAsset.createMany({
          data: ids.map((assetId) => ({ ticketId: id, assetId })),
        });
      }
      await auditRepository.record(
        {
          userId: actor.id,
          action: "ticket.set_affected_assets",
          entity: "ticket",
          entityId: id,
          meta: { assetIds: ids },
        },
        tx,
      );

      const updated = await tx.ticket.findUniqueOrThrow({
        where: { id },
        include: ticketInclude,
      });
      return toTicketDto(updated);
    });
  },
};
