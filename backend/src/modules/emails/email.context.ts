import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/db";
import { getDisplayStatus } from "../../shared/ticket-status";
import type { TicketSummary } from "./email.events";
import type { RecipientContext } from "./email.recipients";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Everything the mail layer needs about a ticket, read once.
 *
 * Every call site that queues an event needs the same six facts plus the
 * recipient's display name, and each of them already sits inside a transaction
 * doing something else. Gathering it here keeps a `select` out of six call sites
 * and — more to the point — keeps the `displayStatus` derivation in one place:
 * the raw `status` column has no `in_progress` value, so a call site that built
 * this shape by hand would eventually mail somebody "New" about a ticket
 * somebody is working on.
 */
export type TicketEmailContext = {
  summary: TicketSummary;
  ctx: Omit<RecipientContext, "actorId">;
  /** The linked problem, for staff payloads only. */
  problem?: { id: number; title: string };
};

export async function loadTicketEmailContext(
  ticketId: number,
  db: Db = prisma,
): Promise<TicketEmailContext | null> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      subject: true,
      status: true,
      priority: true,
      customerId: true,
      categoryId: true,
      requesterId: true,
      assigneeId: true,
      category: { select: { name: true } },
      requester: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      problem: { select: { id: true, title: true } },
    },
  });
  if (!ticket) return null;

  return {
    summary: {
      id: ticket.id,
      subject: ticket.subject,
      displayStatus: getDisplayStatus({
        status: ticket.status,
        assigneeId: ticket.assigneeId,
      }),
      priority: ticket.priority,
      category: ticket.category.name,
      requesterName: ticket.requester.name,
      assigneeName: ticket.assignee?.name ?? null,
    },
    ctx: {
      ticketId: ticket.id,
      customerId: ticket.customerId,
      requesterId: ticket.requesterId,
      assigneeId: ticket.assigneeId,
      categoryId: ticket.categoryId,
    },
    problem: ticket.problem ?? undefined,
  };
}
