import { Prisma } from "@prisma/client";
import type { Priority, Role } from "../../shared/domain";
import {
  canTransition,
  getDisplayStatus,
  toQueryFilter,
  type DisplayStatus,
  type TicketStatus,
  type TicketStatusRecord,
} from "../../shared/ticket-status";
import type { AuthUser } from "../../shared/auth";
import {
  BadRequest,
  ConcurrentStatusChange,
  IllegalTransition,
} from "../../shared/errors";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import {
  notificationRepository,
  notifyBell,
} from "../notifications/notification.repository";
import { loadTicketEmailContext } from "../emails/email.context";
import { emailOutboxService } from "../emails/email-outbox.service";
import { projectRepository } from "../projects/project.repository";
import { resolveRoutedAssignee } from "../projects/project.routing";
import { settingsRepository } from "../settings/settings.repository";
import {
  AUTO_CLOSE_MS,
  computeDueAt,
  deriveSla,
  SLA_ACTIVE_STATUSES,
  SLA_WARN_MS,
  type SlaState,
} from "./sla";
import {
  ticketScopeWhere,
  type AssignmentCandidate,
  type RequesterCandidate,
} from "./ticket.scope";

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
  /** What is stored on the row. Writes name this; readers should not render it. */
  status: TicketStatus;
  /**
   * What a reader is shown — `status` with "In Progress" folded in, derived from
   * the assignee (see `displayStatus`). Sent alongside rather than instead of
   * `status`, because the client needs both: one to show, one to send back on a
   * status change. Every badge, board column, chart and filter reads this.
   */
  displayStatus: DisplayStatus;
  priority: Priority;
  requester: string;
  requesterEmail: string;
  /**
   * The requester's id, so a client can tell "this is my ticket" without
   * comparing display names or email strings. Exposed for the same reason
   * `assigneeId` is: identity questions must be answered on the id.
   */
  requesterId: number;
  /**
   * The requester's role, which decides whether this ticket has an external side
   * — see `isInternalThread`. A ticket raised by staff is worked as an internal
   * thread, so the client needs the role to know which composer to offer; the
   * name and email alone cannot tell it apart from a requester's ticket.
   */
  requesterRole: Role;
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
  /**
   * This ticket's customer's SLA warning window, in milliseconds.
   *
   * Sent PER TICKET rather than once per response because a list can span
   * tenants — a platform-wide super admin sees every customer's work in one
   * table, and each row has to be judged against its own desk's policy. One
   * value for the whole response would be right only for a single-tenant view
   * and quietly wrong for the one that matters most.
   *
   * The badge is computed on the client (see `frontend/features/tickets/sla.ts`)
   * so the client needs the number, not just the server's conclusion.
   */
  slaWarnMs: number;
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
  /** A DISPLAY status — what the reader picked in the filter bar, not a column value. */
  status?: DisplayStatus;
  priority?: Priority;
  /** A user id, or `"none"` for the unassigned queue. Absent = no filter. */
  assigneeId?: number | "none";
};

export type HistoryEntry = {
  id: number;
  /**
   * The words the row was written with, which may be pre-migration ones —
   * ticket_status_history is append-only, so `open`/`in_progress`/`resolved`
   * still appear on old rows. See TicketStatusRecord.
   */
  fromStatus: TicketStatusRecord | null;
  toStatus: TicketStatusRecord;
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
  /**
   * Client-supplied de-duplication key (the `Idempotency-Key` header). When
   * present, repeating the same create returns the ticket the first attempt
   * made instead of raising a second. Absent for callers with no retry to
   * collapse — CSV import, email intake.
   */
  idempotencyKey?: string;
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

/**
 * Map rows to DTOs with each ticket judged against ITS OWN customer's SLA
 * policy, in one lookup for the whole page.
 *
 * A list can span tenants — that is the platform-wide super admin's whole view —
 * so the policy is resolved per customer rather than per request. Note this is
 * deliberately not `rows.map(toTicketDto)`: `map` passes the index as the second
 * argument, which would silently become the warning window.
 */
async function withSlaPolicy(rows: TicketRow[]): Promise<Ticket[]> {
  if (rows.length === 0) return [];
  const policies = await settingsRepository.effectiveForMany(
    rows.map((r) => r.customerId),
  );
  const warnMsOf = (customerId: number) =>
    policies.get(customerId)?.slaWarnMs ?? SLA_WARN_MS;
  return rows.map((row) => toTicketDto(row, warnMsOf));
}

/**
 * Map a row to the API shape.
 *
 * `warnMsOf` looks up the ticket's customer's SLA warning window. It is a
 * function rather than a number because one response can carry several tenants'
 * tickets, and each has to be judged against its own policy. Callers that have
 * not loaded any policy pass nothing and get the deployment default, which is
 * what every read did before customers could configure this.
 */
function toTicketDto(
  row: TicketRow,
  warnMsOf: (customerId: number) => number = () => SLA_WARN_MS,
): Ticket {
  const slaWarnMs = warnMsOf(row.customerId);
  const { slaDue, slaState } = deriveSla(
    row.status,
    row.dueAt,
    new Date(),
    row.resolvedAt,
    slaWarnMs,
  );
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status,
    displayStatus: getDisplayStatus(row),
    priority: row.priority,
    requester: row.requester.name,
    requesterEmail: row.requester.email,
    requesterId: row.requesterId,
    requesterRole: row.requester.role,
    assignee: row.assignee?.name ?? null,
    assigneeId: row.assigneeId,
    category: row.category.name,
    slaDue,
    slaState,
    dueAt: row.dueAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    slaWarnMs,
    attachments: row._count.attachments,
    affectedUsers: row.affectedUsers.map((a) => a.user),
    affectedAssets: row.affectedAssets.map((a) => a.asset),
    problem: row.problem,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

/** Postgres int4: a larger number is not a ticket id, it is a typo. */
const MAX_TICKET_ID = 2_147_483_647;

/**
 * What free text matches in the closed log: the subject, the ticket id, and the
 * requester's name or email.
 *
 * The requester is matched by name/email rather than by id because a picker would
 * need the user directory, which `user:read` gates — so a requester browsing
 * their own closed tickets could not use their own filter.
 *
 * "#1042" and "1042" both mean the id: "#" is how the UI writes ids, so pasting
 * one back in has to work. A number still tries the subject as well — "wave 2" is
 * a real thing to search for.
 */
function textWhere(q: string): Prisma.TicketWhereInput {
  const insensitive = { contains: q, mode: "insensitive" as const };
  const OR: Prisma.TicketWhereInput[] = [
    { subject: insensitive },
    { requester: { name: insensitive } },
    { requester: { email: insensitive } },
  ];
  const id = Number(q.replace(/^#/, ""));
  if (Number.isInteger(id) && id > 0 && id <= MAX_TICKET_ID) OR.push({ id });
  return { OR };
}

export const ticketRepository = {
  async findMany(filter: TicketFilter, user: AuthUser): Promise<Ticket[]> {
    const rows = await prisma.ticket.findMany({
      where: {
        AND: [
          ticketScopeWhere(user),
          // The status filter selects what the reader was SHOWN, so it goes
          // through the same derivation the badge does — see displayStatusWhere.
          filter.status ? toQueryFilter(filter.status) : {},
          {
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
      // Id breaks the tie, as it does for the closed log. `due_at` alone leaves
      // two tickets with the same target in whatever order the plan produces, and
      // ties are the normal case here rather than a rarity: `due_at` is derived
      // from the creation time plus a fixed per-priority target, so any two
      // tickets of the same priority raised in the same instant — a CSV import,
      // a burst of self-service tickets — share one to the millisecond.
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    });
    return withSlaPolicy(rows);
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
  async findClosed(
    filter: {
      /**
       * The calendar window to stay inside, or null for the whole archive within
       * the viewer's scope. Null is what makes the log searchable: nothing can be
       * found by month until you already know which month it is in.
       */
      period: { start: Date; end: Date } | null;
      limit: number;
      offset: number;
      /** Narrow the results, for the log's filter row. Both optional. */
      priority?: Priority;
      /** Free text over subject, id and requester — what "I half-remember it" needs. */
      q?: string;
    },
    user: AuthUser,
  ): Promise<{ items: Ticket[]; total: number }> {
    const where: Prisma.TicketWhereInput = {
      AND: [
        ticketScopeWhere(user),
        { status: "closed" },
        ...(filter.period
          ? [
              {
                closedAt: { gte: filter.period.start, lt: filter.period.end },
              },
            ]
          : []),
        ...(filter.priority ? [{ priority: filter.priority }] : []),
        ...(filter.q ? [textWhere(filter.q)] : []),
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: ticketInclude,
        // Id breaks the tie. `closedAt` alone leaves the order of two tickets
        // closed in the same instant up to the query plan, so consecutive pages
        // could repeat a row and drop another — and bulk closures share a
        // timestamp routinely (the auto-close sweep closes in batches).
        orderBy: [{ closedAt: "desc" }, { id: "desc" }],
        take: filter.limit,
        skip: filter.offset,
      }),
      prisma.ticket.count({ where }),
    ]);
    return { items: await withSlaPolicy(rows), total };
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
      select: { id: true, role: true, customerId: true, isActive: true },
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

  /**
   * Ids of tickets finished before the cutoff and still waiting to be confirmed.
   *
   * `pending` is where the work ends and the wait for the requester starts, and
   * `resolved_at` is stamped on the way in — so this is "done N hours ago,
   * nobody has confirmed", which is exactly what the auto-close sweep wants.
   */
  async findStalePending(cutoff: Date): Promise<number[]> {
    const rows = await prisma.ticket.findMany({
      where: { status: "pending", resolvedAt: { lte: cutoff } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /**
   * Tickets whose running SLA clock reaches `horizon` — i.e. already breached or
   * close enough to warn about. Deliberately unscoped by viewer: this feeds the
   * background sweep, which acts on behalf of the system, not a session.
   *
   * "Running" means everything that has not finished — `pending` included, since
   * its deadline keeps moving whether or not anyone is waiting on the requester.
   * See SLA_ACTIVE_STATUSES.
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

  /**
   * Stamp `deletedAt`, which takes the ticket out of every read (ticketScopeWhere
   * filters on it). Nothing is removed: the comments, attachments and status
   * history stay, so the row can be brought back by clearing the column.
   *
   * The audit row is written in the same transaction as the stamp, like every
   * other mutation here — and it is the only place the deletion is visible
   * afterwards, since the ticket itself is no longer readable.
   */
  async softDelete(id: number, actorId: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "ticket.delete",
          entity: "ticket",
          entityId: id,
          meta: { soft: true },
        },
        tx,
      );
    });
  },

  /**
   * Raise a ticket.
   *
   * With an `idempotencyKey`, repeating the request returns the ticket the first
   * attempt created rather than raising a second one. Two layers, because they
   * cover different things: the lookup up front collapses a *sequential* retry
   * cheaply — the ordinary case, where the response was lost and the person
   * pressed the button again — while the unique constraint collapses the
   * *simultaneous* case, where both requests sail past that lookup together.
   * Only the constraint is authoritative; the lookup is an optimisation.
   */
  async create(input: CreateTicketInput): Promise<Ticket> {
    const actorId = input.actorId ?? input.requesterId;

    if (input.idempotencyKey) {
      const replayed = await findByIdempotencyKey(
        input.requesterId,
        input.idempotencyKey,
      );
      if (replayed) return replayed;
    }

    try {
      return await prisma.$transaction(async (tx) => {
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
            idempotencyKey: input.idempotencyKey ?? null,
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

        const emailCtx = await loadTicketEmailContext(created.id, tx);
        if (emailCtx) {
          // The acknowledgement, and the ONE case where the person who acted is
          // deliberately mailed about their own action. "Do not echo an action
          // back at its author" exists so nobody is told about their own reply;
          // a receipt confirming we have the request, and giving the number to
          // quote, is the opposite — it is addressed to the person who acted
          // precisely because they acted. Hence `actorId: null` rather than the
          // real actor, which would suppress it as self-notification.
          await emailOutboxService.queue(
            {
              event: "ticket.created",
              ctx: { ...emailCtx.ctx, actorId: null },
              sourceRecordId: created.id,
              ticket: emailCtx.summary,
              occurredAt: created.createdAt,
              message: {
                authorName: emailCtx.summary.requesterName,
                body: created.description,
              },
            },
            tx,
          );

          // Nobody was routed to it. This is the #1046 case — a ticket arriving
          // with no owner is exactly the one that can sit unread until it
          // breaches, so the queue behind the category is told at arrival
          // rather than only when the SLA clock finally fires.
          if (assigneeId == null) {
            await emailOutboxService.queue(
              {
                event: "queue.ticket_unassigned",
                ctx: { ...emailCtx.ctx, actorId: actorId ?? null },
                sourceRecordId: created.id,
                ticket: emailCtx.summary,
                occurredAt: created.createdAt,
                message: {
                  authorName: emailCtx.summary.requesterName,
                  body: created.description,
                },
                problem: emailCtx.problem,
              },
              tx,
            );
          }
        }

        return toTicketDto(created);
      });
    } catch (err) {
      // Lost the insert race with a request carrying the same key. The winner's
      // row IS the answer — that is what idempotent means. Anything else, and
      // any unique violation on another constraint, still throws.
      if (input.idempotencyKey && isIdempotencyConflict(err)) {
        const winner = await findByIdempotencyKey(
          input.requesterId,
          input.idempotencyKey,
        );
        if (winner) return winner;
      }
      throw err;
    }
  },

  /** Resolve a category name to its id (case-insensitive). Null if unknown. */
  async findCategoryIdByName(name: string): Promise<number | null> {
    const row = await prisma.category.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  /**
   * Resolve a requester email to its user id (case-insensitive). Null if unknown.
   *
   * Deliberately unscoped: the caller is the email intake, where the sender is a
   * stranger off the internet and there is no actor whose tenant could scope the
   * lookup. Anything with an actor — the CSV import — must go through
   * `findRequesterByEmail` below and `mayImportForRequester` instead.
   */
  async findUserIdByEmail(email: string): Promise<number | null> {
    const row = await prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  /**
   * A prospective requester's id and tenant — the facts `mayImportForRequester`
   * needs to decide whether the importer may file a ticket for them.
   *
   * Returns the candidate rather than filtering by customer in the query, so the
   * tenancy rule stays in one pure, tested place instead of being re-expressed as
   * a where-clause here.
   */
  async findRequesterByEmail(email: string): Promise<RequesterCandidate | null> {
    return prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      select: { id: true, customerId: true },
    });
  },

  async updateAssignee(
    id: number,
    assigneeId: number | null,
    changedById?: number,
  ): Promise<Ticket | null> {
    // Bells ring after the commit, never inside it — see `notifyBell`.
    const { dto, notified } = await prisma.$transaction(async (tx) => {
      let notified: number[] = [];
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) return { dto: null, notified };
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
        ({ notified } = await notificationRepository.createMany(
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
        ));

        // Only the arrival is mailed, not the departure: the person who no
        // longer holds it has nothing to do, and telling them would make every
        // reassignment two mails. Unassigning (`assigneeId` null) mails nobody
        // for the same reason — the queue is told when work ARRIVES in it, by
        // the create path and by the requester-replied event.
        if (assigneeId != null) {
          const emailCtx = await loadTicketEmailContext(id, tx);
          if (emailCtx) {
            await emailOutboxService.queue(
              {
                event: "ticket.assigned",
                ctx: { ...emailCtx.ctx, actorId: changedById ?? null },
                // The new assignee, not the ticket: handing a ticket to Ann,
                // then to Bob, then back to Ann is three distinct pieces of
                // news, and keying on the ticket would deliver only the first.
                sourceRecordId: assigneeId,
                ticket: emailCtx.summary,
                occurredAt: new Date(),
                problem: emailCtx.problem,
              },
              tx,
            );
          }
        }
      }

      return { dto: toTicketDto(updated), notified };
    });
    notifyBell(notified);
    return dto;
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

  /**
   * Move a ticket to `status`, recording the history row the SLA is measured
   * from. Returns null when the ticket does not exist.
   *
   * The transition is applied as a **compare-and-swap** on the status we
   * validated against, not as a plain update. The service checks
   * `canTransition` against a read taken outside this transaction, and Postgres
   * runs us at READ COMMITTED — so another request can commit a different
   * status in between, and its row lock is released before we get here.
   * Re-reading inside the transaction does not help: that read can be just as
   * stale. Pinning the old status in the WHERE makes the check and the write one
   * atomic step, so losing the race updates nothing instead of writing a move
   * the whitelist forbids. Two agents on the same `open` ticket could otherwise
   * persist `open → resolved` and then `resolved → pending`, appending an
   * illegal row to `ticket_status_history`.
   */
  async updateStatus(
    id: number,
    status: TicketStatus,
    changedById?: number,
  ): Promise<Ticket | null> {
    // Bells ring after the commit, never inside it — see `notifyBell`.
    const { dto, notified } = await prisma.$transaction(async (tx) => {
      let notified: number[] = [];
      const current = await tx.ticket.findUnique({
        where: { id },
        include: ticketInclude,
      });
      if (!current) return { dto: null, notified };

      // Already there — a double-submitted request, or two people choosing the
      // same move. Nothing to validate and nothing to record, but not an error:
      // the ticket is where the caller asked it to be.
      if (current.status === status)
        return { dto: toTicketDto(current), notified };

      // The whitelist is enforced here as well as in the service: this is the
      // only place that can check it against the row it is about to write.
      if (!canTransition(current.status, status)) {
        throw IllegalTransition(current.status, status);
      }

      const swap = await tx.ticket.updateMany({
        where: { id, status: current.status },
        data: {
          status,
          // Pending is where the work finished, so that is where the resolution
          // clock stops. Only stamped on the first arrival: a ticket rejected
          // back to `new` and finished again keeps the time it was first done,
          // which is what the SLA target was set against.
          ...(status === "pending" && current.resolvedAt == null
            ? { resolvedAt: new Date() }
            : {}),
          ...(status === "closed" ? { closedAt: new Date() } : {}),
        },
      });
      if (swap.count === 0) {
        // Someone else moved it between our read and this write. Report what we
        // found rather than retrying from it — see ConcurrentStatusChange.
        const actual = await tx.ticket.findUnique({
          where: { id },
          select: { status: true },
        });
        throw ConcurrentStatusChange(
          current.status,
          status,
          actual?.status ?? "unknown",
        );
      }

      // Append the SLA source-of-truth row + audit. Reached only on a real
      // change: the no-op case returned above.
      const historyRow = await tx.ticketStatusHistory.create({
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
      ({ notified } = await notificationRepository.createMany(
        recipientsFor(current, changedById).map((userId) => ({
          userId,
          type: "ticket.status_change",
          ticketId: id,
          message: `Ticket #${id} moved to ${status.replace("_", " ")}`,
        })),
        tx,
      ));

      // Two of the three destinations are worth writing to the requester about,
      // and the third is not:
      //
      //   → pending  the work is done and it is now THEIR move — the mail
      //              carries the confirm/reopen links, because a two-sided
      //              closure that nobody is told to answer is a 72h timeout
      //              wearing an agreement's clothes
      //   → closed   it is over, and the mail says whether a person decided
      //              that or the clock did
      //   → new      a reopen. Announced by whoever caused it: the requester's
      //              rejection is mailed to the desk from the closure path,
      //              which is the only caller that knows a rejection is what
      //              this was. Mailing from here would say "reopened" without
      //              being able to say why.
      if (status === "pending" || status === "closed") {
        const emailCtx = await loadTicketEmailContext(id, tx);
        if (emailCtx) {
          const actorName =
            changedById != null
              ? ((
                  await tx.user.findUnique({
                    where: { id: changedById },
                    select: { name: true },
                  })
                )?.name ?? undefined)
              : undefined;
          await emailOutboxService.queue(
            {
              event: status === "pending" ? "ticket.pending" : "ticket.closed",
              // The requester confirming their own closure does not need to be
              // told they confirmed it; the desk closing it means they do.
              ctx: { ...emailCtx.ctx, actorId: changedById ?? null },
              // The history row: a ticket can travel pending → new → pending,
              // and each arrival is its own piece of news.
              sourceRecordId: historyRow.id,
              ticket: emailCtx.summary,
              occurredAt: new Date(),
              vars: {
                ...(actorName ? { actor: actorName } : {}),
                hours: Math.round(AUTO_CLOSE_MS / 3_600_000),
              },
            },
            tx,
          );
        }
      }

      // `updateMany` cannot return relations, so re-read for the DTO.
      const updated = await tx.ticket.findUnique({
        where: { id },
        include: ticketInclude,
      });
      return { dto: updated ? toTicketDto(updated) : null, notified };
    });
    notifyBell(notified);
    return dto;
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

/**
 * The ticket a previous request with this key already created, if any.
 *
 * Scoped to the requester because the key is minted client-side with no
 * coordination: two people can pick the same string, and an unscoped lookup
 * would hand one person's ticket to the other. A soft-deleted row is not a
 * replay to return — it is gone, and the retry should raise a fresh ticket.
 */
async function findByIdempotencyKey(
  requesterId: number,
  idempotencyKey: string,
): Promise<Ticket | null> {
  const row = await prisma.ticket.findFirst({
    where: { requesterId, idempotencyKey, deletedAt: null },
    include: ticketInclude,
  });
  return row ? toTicketDto(row) : null;
}

/**
 * Is this the unique violation on `(requesterId, idempotencyKey)` specifically?
 * Matched on the target columns rather than the P2002 code alone, so a
 * collision on some unrelated constraint is never quietly answered with the
 * wrong ticket.
 */
function isIdempotencyConflict(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== "P2002"
  ) {
    return false;
  }
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target : [String(target ?? "")];
  return fields.some((f) => String(f).includes("idempotency_key"));
}
