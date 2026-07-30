import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";
import { ticketScopeWhere } from "../tickets/ticket.scope";
import type { ProblemStatus } from "./problem.types";

/**
 * Row-level problem visibility, mirroring `ticketScopeWhere`: admins see every
 * customer, everyone else only their own. A non-admin without a customer matches
 * nothing (defensive).
 */
export function problemScopeWhere(user: AuthUser): Prisma.ProblemWhereInput {
  if (user.role === "admin") return {};
  if (user.customerId == null) return { id: -1 };
  return { customerId: user.customerId };
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
  createdBy: { id: number; name: string } | null;
  ticketCount: number;
  createdAt: string;
};

function toDto(row: ProblemRow, ticketCount = 0): ProblemDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    rootCause: row.rootCause,
    workaround: row.workaround,
    createdBy: row.createdBy,
    ticketCount,
    createdAt: row.createdAt.toISOString(),
  };
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
    return rows.map((r) => toDto(r, r._count.tickets));
  },

  async findById(id: number, actor: AuthUser): Promise<ProblemDto | null> {
    const row = await prisma.problem.findFirst({
      where: { AND: [{ id }, problemScopeWhere(actor)] },
      include: { ...problemInclude, _count: { select: { tickets: true } } },
    });
    return row ? toDto(row, row._count.tickets) : null;
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
    return prisma.$transaction(async (tx) => {
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
      return toDto(created, 1);
    });
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
