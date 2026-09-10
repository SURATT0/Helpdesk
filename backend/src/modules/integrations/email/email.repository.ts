import { prisma } from "../../../shared/db";
import { auditRepository } from "../../audit/audit.repository";
import { senderMayReply } from "./email.scope";

export const emailRepository = {
  /**
   * Resolve the category new email tickets should land in: the preferred name
   * (case-insensitive) if it exists, else the first category by id. Null only
   * if the instance has no categories at all.
   */
  /**
   * A category to file an emailed ticket under, WITHIN the requester's own
   * customer.
   *
   * The tenant argument is required and there is no unscoped path, which is the
   * fix for a real break: this used to search every category on the platform and
   * fall back to the lowest id anywhere. That was harmless while categories were
   * shared and belonged to nobody. Once each tenant owns its own, it resolved a
   * Globex sender's mail to an Acme row — and the ticket writer would then refuse
   * it, so mail from every customer but the lowest-numbered one stopped becoming
   * tickets at all.
   *
   * The fallback stays, and stays inside the tenant: any category of THEIRS is a
   * reasonable place to put a mail that named none, where no ticket at all is
   * not. Ordered by id so the choice is at least stable between calls.
   */
  async resolveCategoryId(
    customerId: number,
    preferredName?: string,
  ): Promise<number | null> {
    if (preferredName) {
      const byName = await prisma.category.findFirst({
        where: {
          customerId,
          name: { equals: preferredName.trim(), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
    const first = await prisma.category.findFirst({
      where: { customerId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return first?.id ?? null;
  },

  /**
   * Which customer a requester belongs to — the tenant their emailed ticket is
   * filed under, and the one its category has to come from.
   *
   * Read from the USER rather than from `EMAIL_DEFAULT_CUSTOMER`, because the two
   * differ for the case that matters: a KNOWN sender is filed under their own
   * customer whatever the default says, and the default only ever decides where
   * a stranger lands.
   */
  async findCustomerIdOfUser(userId: number): Promise<number | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true },
    });
    return user?.customerId ?? null;
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
   * `customerId` is required for the create path: a user with no customer produces
   * a ticket with no customer, and `ticketScopeWhere` matches staff on `customerId`
   * equality — so such a ticket is invisible to all customer-bound staff, and only
   * a platform-wide super admin would ever find it.
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
        role: "user",
        passwordHash: null,
        customerId,
        // `active`, not `pending`, and the difference matters twice over.
        //
        // This row is a CORRESPONDENT, not an application: the desk has already
        // accepted their mail and filed a ticket for them, and nobody asked to
        // join anything. Routing them into the approval queue would fill it with
        // every address that ever wrote in, and "approving" one would grant
        // nothing, because what keeps them out of the app is the null password
        // below, not their status.
        //
        // That null is load-bearing, so the password-reset path must refuse an
        // account that has never had a password — otherwise anyone could mail the
        // desk, get a row created, and then "reset" their way into the tenant.
        // See `auth.service.requestPasswordReset`, which is where that is
        // enforced.
        status: "active",
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

    // Grants come along because reach decides this the same way it decides the
    // ticket list. Without them, an agent covering a second customer would have
    // their mailed reply refused and silently opened as a NEW ticket — the
    // thread splitting for no reason the sender can see.
    const row = await prisma.user.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        role: true,
        customerId: true,
        reachGrants: { select: { customerId: true } },
      },
    });
    const sender = row && {
      id: row.id,
      role: row.role,
      customerId: row.customerId,
      customerIds: row.reachGrants.map((g) => g.customerId),
    };

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
