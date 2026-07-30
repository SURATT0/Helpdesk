import { prisma } from "../../../shared/db";
import { auditRepository } from "../../audit/audit.repository";
import { senderMayReply } from "./email.scope";

export const emailRepository = {
  /**
   * Resolve the category new email tickets should land in: the preferred name
   * (case-insensitive) if it exists, else the first category by id. Null only
   * if the instance has no categories at all.
   */
  async resolveCategoryId(preferredName?: string): Promise<number | null> {
    if (preferredName) {
      const byName = await prisma.category.findFirst({
        where: { name: { equals: preferredName.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    const first = await prisma.category.findFirst({
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return first?.id ?? null;
  },

  /**
   * Resolve the tenant an unknown email sender is filed under, by exact
   * (case-insensitive) customer name. Unlike `resolveCategoryId` there is
   * deliberately NO "first row" fallback: picking an arbitrary tenant would file
   * a stranger's mail inside someone else's customer.
   */
  async resolveCustomerId(name: string): Promise<number | null> {
    const found = await prisma.customer.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    return found?.id ?? null;
  },

  /**
   * Find a user by email, or create a `requester` for an unknown sender. The
   * created user has no password (they never sign in — they only correspond by
   * email), matching the nullable password_hash column.
   *
   * `customerId` is required for the create path: a requester with no customer
   * produces a ticket with no customer, and `ticketScopeWhere` matches staff on
   * `customerId` equality — so such a ticket is invisible to every agent and
   * manager, and only a platform admin would ever find it.
   */
  async findOrCreateRequester(
    email: string,
    name: string | undefined,
    customerId: number,
  ): Promise<{ id: number; created: boolean }> {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const created = await prisma.user.create({
      data: {
        name: name?.trim() || email.split("@")[0],
        email: email.toLowerCase(),
        role: "requester",
        passwordHash: null,
        customerId,
      },
      select: { id: true },
    });
    await auditRepository.record({
      userId: null,
      action: "user.create",
      entity: "user",
      entityId: created.id,
      meta: { via: "email", email, customerId },
    });
    return { id: created.id, created: true };
  },

  /**
   * The ticket a mailed reply is claiming, with just enough context to decide
   * whether this sender is allowed to append to it.
   *
   * The `[#123]` subject tag is attacker-controllable — anyone can type it — so
   * finding the ticket is NOT authorization. This method only gathers facts; the
   * decision itself lives in `senderMayReply` (./email.scope), kept pure and unit
   * tested alongside the other scope rules. A sender who fails it falls through to
   * opening a new ticket, which loses no mail while keeping strangers out of an
   * existing thread.
   */
  async findReplyTarget(
    ticketId: number,
    senderId: number,
  ): Promise<{
    id: number;
    requesterId: number;
    assigneeId: number | null;
    senderMayReply: boolean;
  } | null> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assigneeId: true,
        customerId: true,
        affectedUsers: { select: { userId: true } },
      },
    });
    if (!ticket) return null;

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { id: true, role: true, customerId: true },
    });

    return {
      id: ticket.id,
      requesterId: ticket.requesterId,
      assigneeId: ticket.assigneeId,
      senderMayReply:
        sender != null &&
        senderMayReply(
          {
            requesterId: ticket.requesterId,
            assigneeId: ticket.assigneeId,
            customerId: ticket.customerId,
            affectedUserIds: ticket.affectedUsers.map((a) => a.userId),
          },
          sender,
        ),
    };
  },
};
