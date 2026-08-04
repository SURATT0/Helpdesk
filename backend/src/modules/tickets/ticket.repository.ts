import { Prisma } from "@prisma/client";
import type { Priority, TicketStatus } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { BadRequest } from "../../shared/errors";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { notificationRepository } from "../notifications/notification.repository";
import { projectRepository } from "../projects/project.repository";
import { resolveRoutedAssignee } from "../projects/project.routing";
import {
  computeDueAt,
  deriveSla,
  SLA_ACTIVE_STATUSES,
  type SlaState,
} from "./sla";
import { ticketScopeWhere, type AssignmentCandidate } from "./ticket.scope";

/** A ticket the SLA sweep may need to raise an alert for. */
export type SlaRiskTicket = {
  id: number;
  subject: string;
  dueAt: Date | null;
  assigneeId: number | null;
  customerId: number | null;
};

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
  /**
   * The assignee's id alongside their display name. The client filters and
   * groups by assignee, and names are not unique — two "J. Petrov"s would
   * collapse into one bucket if the id weren't exposed.
   */
  assigneeId: number | null;
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
  /** A user id, or `"none"` for the unassigned queue. Absent = no filter. */
  assigneeId?: number | "none";
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
    assigneeId: row.assigneeId,
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
            // `"none"` is the unassigned queue; a number is one agent's load.
            ...(filter.assigneeId != null
              ? {
                  assigneeId:
                    filter.assigneeId === "none" ? null : filter.assigneeId,
                }
              : {}),
          },
        ],
      },
      include: ticketInclude,
      orderBy: { dueAt: "asc" },
    });
    return rows.map(toTicketDto);
  },

  /**
   * The closed-ticket history log: tickets whose `closedAt` falls inside the
   * half-open window `[start, end)`, newest first. `total` is the count within
   * the same scope and window, for pagination.
   *
   * Row scope is AND-ed in exactly as it is for the live list above, so no
   * window can widen what a viewer sees — a requester's log holds only their own
   * tickets.
   *
   * The `status` check rides along with the date range on purpose. `closedAt` is
   * stamped on the transition into `closed` and deliberately never cleared (the
   * 30-day reopen check in the service reads it back), so a reopened ticket
   * still carries the timestamp of its earlier closure; requiring the status too
   * keeps it out of the log until it is genuinely closed again.
   */
  async findClosedInPeriod(
    window: { start: Date; end: Date; limit: number; offset: number },
    user: AuthUser,
  ): Promise<{ items: Ticket[]; total: number }> {
    const where: Prisma.TicketWhereInput = {
      AND: [
        ticketScopeWhere(user),
        { status: "closed", closedAt: { gte: window.start, lt: window.end } },
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: { closedAt: "desc" },
        take: window.limit,
        skip: window.offset,
      }),
      prisma.ticket.count({ where }),
    ]);
    return { items: rows.map(toTicketDto), total };
  },

  /**
   * Every `closedAt` in the viewer's scope, newest first — the raw material for
   * the history log's period picker.
   *
   * Deliberately just the timestamps: which calendar bucket each falls into is
   * business logic, because the boundaries are server-local and defined in
   * `history.period.ts`, so the grouping happens in the service. The reports
   * module aggregates the same way, over fetched rows rather than in SQL.
   *
   * Fine at help-desk scale, where the closed archive is thousands of rows at
   * most. If it ever outgrows that, this becomes a grouped query with an explicit
   * timezone — and the period boundaries would have to move into SQL with it.
   */
  async findClosedAtValues(user: AuthUser): Promise<Date[]> {
    const rows = await prisma.ticket.findMany({
      where: {
        AND: [
          ticketScopeWhere(user),
          { status: "closed", closedAt: { not: null } },
        ],
      },
      select: { closedAt: true },
      orderBy: { closedAt: "desc" },
    });
    return rows.flatMap((r) => (r.closedAt ? [r.closedAt] : []));
  },

  /**
   * A prospective assignee's role and tenant — the facts `mayReceiveAssignment`
   * needs. Intentionally NOT scoped: staff directories are readable within a
   * tenant, and the decision function is what rejects an out-of-tenant target.
   */
  async findAssignmentCandidate(
    userId: number,
  ): Promise<AssignmentCandidate | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, customerId: true },
    });
  },

  /**
   * Ids of the tickets one person is holding, within the caller's own row scope
   * — so a manager reassigning a departing agent can never reach another
   * customer's tickets, even by passing their user id.
   *
   * Capped, and the caller is told how many were left over rather than being
   * quietly handed a truncated set.
   */
  async findIdsByAssignee(
    assigneeId: number,
    statuses: TicketStatus[],
    user: AuthUser,
    limit: number,
  ): Promise<{ ids: number[]; remaining: number }> {
    const where: Prisma.TicketWhereInput = {
      AND: [ticketScopeWhere(user), { assigneeId, status: { in: statuses } }],
    };
    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        select: { id: true },
        orderBy: { id: "asc" },
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    return { ids, remaining: Math.max(0, total - ids.length) };
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

  /**
   * Tickets whose running SLA clock reaches `horizon` — i.e. already breached or
   * close enough to warn about. Deliberately unscoped by viewer: this feeds the
   * background sweep, which acts on behalf of the system, not a session. Only
   * statuses whose clock is actually running are considered, so a `pending`
   * ticket (paused) never raises an alert.
   */
  async findSlaRisk(horizon: Date): Promise<SlaRiskTicket[]> {
    return prisma.ticket.findMany({
      where: {
        status: { in: [...SLA_ACTIVE_STATUSES] },
        dueAt: { not: null, lte: horizon },
      },
      select: {
        id: true,
        subject: true,
        dueAt: true,
        assigneeId: true,
        customerId: true,
      },
      orderBy: { dueAt: "asc" },
    }) as Promise<SlaRiskTicket[]>;
  },

  /**
   * The super admins belonging to one customer — the fallback recipients for an
   * unassigned ticket's SLA alert, since there is no assignee to tell.
   *
   * Requiring a `customerId` is what keeps platform-wide super admins out: they
   * span every customer and would drown in every tenant's noise. That is also why
   * a null argument returns nobody rather than everybody.
   */
  async findCustomerSuperAdminIds(
    customerId: number | null,
  ): Promise<number[]> {
    if (customerId == null) return [];
    const rows = await prisma.user.findMany({
      where: { role: "super_admin", customerId },
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

      // Refuse rather than file the ticket outside every tenant. users.customerId is
      // nullable on purpose (null = platform staff, what isPlatformWide keys on), but
      // tickets.customerId is not: ticketScopeWhere matches staff on customerId
      // equality, so a tenant-less ticket is invisible to every customer-bound admin
      // and only a platform-wide super_admin would ever find it. Same stance the email
      // intake takes when it cannot name a tenant for an unknown sender.
      if (requester?.customerId == null) {
        throw BadRequest(
          "The requester belongs to no customer, so there is no tenant to file this ticket under. " +
            "Platform staff should raise it on behalf of a user inside the customer it concerns.",
        );
      }

      // Auto-assignment. If the requester belongs to a project, the ticket goes
      // to that project's caseworker — its owner, or the backup when the owner is
      // unavailable. Read inside this transaction so the routing decision sees
      // the same snapshot as the insert.
      //
      // Falling through to null is the pre-existing behaviour and a fine outcome:
      // an unassigned ticket sits in the queue where the category's default team
      // picks it up (implicitly, via the repository scope), which is better than
      // parking it on someone who is away.
      const assigneeId = resolveRoutedAssignee(
        await projectRepository.findRoutingForRequester(input.requesterId, tx),
      );

      const now = new Date();
      const created = await tx.ticket.create({
        data: {
          subject: input.subject,
          description: input.description,
          status: "new",
          priority: input.priority,
          requesterId: input.requesterId,
          customerId: requester.customerId,
          assigneeId,
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
