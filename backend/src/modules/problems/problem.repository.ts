import { Prisma } from "@prisma/client";
import { isPlatformWide, type AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { kbService } from "../kb/kb.service";
import {
  notificationRepository,
  notifyBell,
} from "../notifications/notification.repository";
import { ticketScopeWhere } from "../tickets/ticket.scope";
import type { ProblemState } from "./problem.rules";
import type { ProblemStatus } from "./problem.types";
import type { UpdateProblemInput } from "./problem.validators";

/**
 * Row-level problem visibility, mirroring `ticketScopeWhere`: a platform-wide
 * principal sees every customer, staff only their own. Staff without a customer
 * who are not platform-wide match nothing (defensive).
 *
 * A requester reaches a problem only THROUGH a ticket they can see. The register
 * itself is somebody else's work — other people's incidents, grouped by a cause
 * they have no part in — but the problem attached to their own ticket is the
 * answer to why it is waiting, and it carries the workaround.
 *
 * That arm is expressed with `ticketScopeWhere` rather than a second copy of
 * "their own tickets", so the two can never disagree: whatever a requester may
 * see on the ticket list is exactly what can carry a problem into their reach.
 */
export function problemScopeWhere(user: AuthUser): Prisma.ProblemWhereInput {
  if (isPlatformWide(user)) return {};
  if (user.customerId == null) return { id: -1 };
  const ownCustomer = { customerId: user.customerId };
  if (user.role !== "user") return ownCustomer;
  return {
    AND: [ownCustomer, { tickets: { some: ticketScopeWhere(user) } }],
  };
}

const problemInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ProblemInclude;

type ProblemRow = Prisma.ProblemGetPayload<{ include: typeof problemInclude }>;

export type ProblemDto = {
  id: number;
  title: string;
  description: string | null;
  status: ProblemStatus;
  rootCause: string | null;
  workaround: string | null;
  /** The stored KB article id, whether or not it still resolves. */
  kbArticleId: string | null;
  /**
   * The same article resolved against the KB dataset, or null when the id no
   * longer matches anything. Both fields are exposed on purpose: an id present
   * with a null reference is a STALE link, and the UI can say so instead of
   * silently dropping it.
   */
  kbArticle: { id: string; title: string; category: string } | null;
  createdBy: { id: number; name: string } | null;
  ticketCount: number;
  createdAt: string;
};

type KbLink = ProblemDto["kbArticle"];

function toDto(
  row: ProblemRow,
  ticketCount: number,
  kbArticle: KbLink,
): ProblemDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    rootCause: row.rootCause,
    workaround: row.workaround,
    kbArticleId: row.kbArticleId,
    kbArticle,
    createdBy: row.createdBy,
    ticketCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Map rows to DTOs, resolving their knowledge-base links in ONE query for the
 * whole batch.
 *
 * The link used to be free — the KB was an in-process dataset — and is now a
 * table, so resolving it inside the per-row mapper would mean a query per row on
 * a page of problems. Batching keeps it at one regardless of page size.
 */
async function toDtos(
  rows: (ProblemRow & { ticketCount: number })[],
): Promise<ProblemDto[]> {
  const refs = await kbService.referencesFor(rows.map((r) => r.kbArticleId));
  return rows.map((r) =>
    toDto(r, r.ticketCount, (r.kbArticleId && refs.get(r.kbArticleId)) || null),
  );
}

async function toOneDto(
  row: ProblemRow,
  ticketCount: number,
): Promise<ProblemDto> {
  const [dto] = await toDtos([{ ...row, ticketCount }]);
  return dto;
}

export const problemRepository = {
  /** Scoped list, newest first — powers the "link to existing problem" picker. */
  async findMany(
    actor: AuthUser,
    opts: { search?: string; status?: ProblemStatus; limit?: number } = {},
  ): Promise<ProblemDto[]> {
    const search = opts.search?.trim();
    const rows = await prisma.problem.findMany({
      where: {
        AND: [
          problemScopeWhere(actor),
          opts.status ? { status: opts.status } : {},
          search ? { title: { contains: search, mode: "insensitive" } } : {},
        ],
      },
      include: { ...problemInclude, _count: { select: { tickets: true } } },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 100,
    });
    return toDtos(rows.map((r) => ({ ...r, ticketCount: r._count.tickets })));
  },

  async findById(id: number, actor: AuthUser): Promise<ProblemDto | null> {
    const row = await prisma.problem.findFirst({
      where: { AND: [{ id }, problemScopeWhere(actor)] },
      include: { ...problemInclude, _count: { select: { tickets: true } } },
    });
    return row ? toOneDto(row, row._count.tickets) : null;
  },

  /** The fields the edit rules need, scoped — null when out of scope. */
  async findStateForUpdate(
    id: number,
    actor: AuthUser,
  ): Promise<ProblemState | null> {
    const row = await prisma.problem.findFirst({
      where: { AND: [{ id }, problemScopeWhere(actor)] },
      select: { status: true, workaround: true },
    });
    return row ?? null;
  },

  /**
   * Apply an edit. Row scope is checked by the caller via `findStateForUpdate`,
   * so reaching here means the problem is visible to the actor.
   *
   * `announce` is decided by the pure rules, not here: when a workaround first
   * becomes available, everyone holding a linked incident is told, because a
   * workaround nobody hears about is the same as no workaround. Requesters are
   * not notified — this is internal remediation detail.
   */
  async update(
    id: number,
    patch: UpdateProblemInput,
    actor: AuthUser,
    announce: boolean,
  ): Promise<ProblemDto> {
    let notified: number[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.problem.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
          ...(patch.rootCause !== undefined
            ? { rootCause: patch.rootCause }
            : {}),
          ...(patch.workaround !== undefined
            ? { workaround: patch.workaround }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.kbArticleId !== undefined
            ? { kbArticleId: patch.kbArticleId }
            : {}),
        },
        include: { ...problemInclude, _count: { select: { tickets: true } } },
      });

      await auditRepository.record(
        {
          userId: actor.id,
          action: "problem.update",
          entity: "problem",
          entityId: id,
          // Field NAMES plus the new status only. Root cause and workaround are
          // free text that can run to 5k chars; the audit row records that they
          // changed, not their contents.
          meta: {
            fields: Object.keys(patch),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
          },
        },
        tx,
      );

      if (announce) {
        const linked = await tx.ticket.findMany({
          where: { problemId: id, assigneeId: { not: null } },
          select: { id: true, assigneeId: true },
        });
        ({ notified } = await notificationRepository.createMany(
          linked
            .filter((t) => t.assigneeId !== actor.id)
            .map((t) => ({
              userId: t.assigneeId as number,
              type: "problem.workaround_available",
              ticketId: t.id,
              message: `A workaround is now documented for "${updated.title}" — see ticket #${t.id}`,
            })),
          tx,
        ));
      }

      return updated;
    });
    // After the commit, never inside it — see `notifyBell`.
    notifyBell(notified);
    return toOneDto(updated, updated._count.tickets);
  },

  /**
   * Create a problem and, in the same transaction, link the source ticket to it.
   * This is the "convert to problem" path — the ticket stays an incident and is
   * never deleted; it simply gains a parent problem.
   */
  async createFromTicket(
    data: {
      title: string;
      description?: string | null;
      ticketId: number;
      customerId: number | null;
    },
    actor: AuthUser,
  ): Promise<ProblemDto> {
    const created = await prisma.$transaction(async (tx) => {
      const created = await tx.problem.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          customerId: data.customerId,
          createdById: actor.id,
        },
        include: problemInclude,
      });
      await tx.ticket.update({
        where: { id: data.ticketId },
        data: { problemId: created.id },
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "problem.create_from_ticket",
          entity: "problem",
          entityId: created.id,
          meta: { ticketId: data.ticketId, title: created.title },
        },
        tx,
      );
      return created;
    });
    return toOneDto(created, 1);
  },

  /** Point a ticket at an existing problem (or clear it when `problemId` null). */
  async linkTicket(
    ticketId: number,
    problemId: number | null,
    actor: AuthUser,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data: { problemId } });
      await auditRepository.record(
        {
          userId: actor.id,
          action: problemId == null ? "problem.unlink_ticket" : "problem.link_ticket",
          entity: "ticket",
          entityId: ticketId,
          meta: { problemId },
        },
        tx,
      );
    });
  },

  /** Whether the problem exists inside the actor's scope. */
  async isInScope(id: number, actor: AuthUser): Promise<boolean> {
    const count = await prisma.problem.count({
      where: { AND: [{ id }, problemScopeWhere(actor)] },
    });
    return count > 0;
  },

  /**
   * The source ticket for a link/convert, scoped with the SAME clause the ticket
   * repository uses — so a ticket the actor cannot see reads as absent. Returns
   * the tenant too: a converted problem inherits its ticket's customer.
   */
  findTicketForLink(
    ticketId: number,
    actor: AuthUser,
  ): Promise<{ id: number; customerId: number | null } | null> {
    return prisma.ticket.findFirst({
      where: { AND: [{ id: ticketId }, ticketScopeWhere(actor)] },
      select: { id: true, customerId: true },
    });
  },
};
