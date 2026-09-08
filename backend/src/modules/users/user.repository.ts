import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import type { Lang } from "../../shared/i18n";
import {
  customerReach,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { prisma } from "../../shared/db";
import { BadRequest } from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { projectScopeWhere } from "../projects/project.scope";
import { ACTIVE_STATUSES } from "../tickets/ticket.validators";

/**
 * Row-level scope for the user directory (multi-tenant): a platform-wide
 * principal sees/manages everyone across all customers; everyone else is limited
 * to members of the customers they reach, across all departments. Staff who
 * reach no customer and are not platform-wide match nothing (defensive).
 *
 * Note what this deliberately does NOT include: someone granted reach into a
 * customer appears in that customer's directory only if they BELONG to it.
 * Reach is permission to see a tenant's work, not membership of it, and listing
 * outside staff as members would put them in the assignee picker and the
 * workload report as though they were part of the desk.
 */
function scopeWhere(actor: AuthUser): Prisma.UserWhereInput {
  if (isPlatformWide(actor)) return {};
  const reach = customerReach(actor);
  if (reach.length === 0) return { id: -1 };
  return { customerId: { in: reach } };
}

/**
 * The actor's reach as a list safe to put in an `IN (...)`, where an empty reach
 * has to match nothing rather than everything. `[-1]` is the same positive-id
 * sentinel the scope builders use; an empty array would also be safe in Prisma,
 * but saying it once here keeps the intent visible at the call site.
 */
function reachOrNothing(actor: AuthUser): number[] {
  const reach = customerReach(actor);
  return reach.length > 0 ? reach : [-1];
}

const userInclude = {
  customer: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  // Named, not just counted: "covers Acme and Globex" is the whole content of
  // the grant, and a number would send the screen back for the names anyway.
  reachGrants: {
    select: { customer: { select: { id: true, name: true } } },
    orderBy: { customer: { name: "asc" } },
  },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export type UserDto = {
  id: number;
  name: string;
  email: string;
  role: Role;
  team: { id: number; name: string } | null;
  /**
   * The customer this person BELONGS to. Null for platform staff.
   *
   * Distinct from `reach` below: this is where they are, that is where else
   * they may work. Shown only to viewers who can see more than one tenant —
   * for everyone else the column would hold the same name on every row.
   */
  customer: { id: number; name: string } | null;
  /** Routing group this user's tickets flow through. Never a visibility scope. */
  project: { id: number; name: string } | null;
  /** False = project routing skips this person (they are away). */
  availableForAssignment: boolean;
  /** False = the account is closed: no sign-in, no new work. See User.isActive. */
  isActive: boolean;
  /**
   * The language this person has chosen, or null if they never have. Each
   * reader falls back differently (the app to English, mail to Thai), so the
   * null is passed through rather than resolved here.
   */
  language: Lang | null;
  /**
   * Customers this person may work BEYOND the one they belong to.
   *
   * Only the granted extras, not the effective reach: their own customer is
   * already on the row and repeating it here would make an ordinary account look
   * like it had been given something. Empty for almost everyone.
   */
  reach: { id: number; name: string }[];
  createdAt: string;
};

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    customer: row.customer,
    team: row.team,
    project: row.project,
    availableForAssignment: row.availableForAssignment,
    isActive: row.isActive,
    language: row.language,
    // A grant naming the user's own customer is stored happily but says nothing,
    // so it is dropped here rather than shown as an extra the person does not have.
    reach: row.reachGrants
      .map((g) => g.customer)
      .filter((c) => c.id !== row.customerId),
    createdAt: row.createdAt.toISOString(),
  };
}

export const userRepository = {
  async findMany(actor: AuthUser): Promise<UserDto[]> {
    const rows = await prisma.user.findMany({
      where: scopeWhere(actor),
      include: userInclude,
      orderBy: { name: "asc" },
    });
    return rows.map(toDto);
  },

  async findById(id: number, actor: AuthUser): Promise<UserDto | null> {
    // Out-of-scope users 404 rather than leak their existence.
    const row = await prisma.user.findFirst({
      where: { id, ...scopeWhere(actor) },
      include: userInclude,
    });
    return row ? toDto(row) : null;
  },

  async updateProfile(
    id: number,
    data: { name?: string; availableForAssignment?: boolean; language?: Lang },
    actorId: number,
  ): Promise<UserDto | null> {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({ where: { id } });
      if (!exists) return null;
      const updated = await tx.user.update({
        where: { id },
        data,
        include: userInclude,
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "user.profile_update",
          entity: "user",
          entityId: id,
          meta: {
            name: data.name,
            availableForAssignment: data.availableForAssignment,
            language: data.language,
          },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  /**
   * How much unfinished work is still assigned to this person, within the
   * caller's scope — what stands between an account and being closed.
   *
   * Counts assignments only, not tickets they raised: a requester's own history
   * stays theirs and is no reason to keep the door open. Scoped like every other
   * read here, so a manager cannot probe another customer's workload.
   */
  async countOpenAssigned(id: number, actor: AuthUser): Promise<number> {
    return prisma.ticket.count({
      where: {
        assigneeId: id,
        deletedAt: null,
        // Anything not closed, pending included: the work is done, but a
        // rejection would land back on this person. See ACTIVE_STATUSES.
        status: { in: [...ACTIVE_STATUSES] },
        ...(isPlatformWide(actor)
          ? {}
          : { customerId: { in: reachOrNothing(actor) } }),
      },
    });
  },

  /**
   * The target's own role and tenant, plus how many OTHER active super admins
   * share that tenant — everything the last-admin check needs, in one read.
   *
   * Deliberately unscoped by actor. This is a system invariant rather than a
   * directory read: the answer is a count about a user the caller is already
   * editing, and scoping it would make the guard weaker for exactly the actor
   * whose reach is narrowest.
   *
   * `customerId: null` is its own group, not a wildcard. A platform-wide super
   * admin is not a member of any customer, so a customer's own super admin does
   * not stand in for them — nor the reverse.
   */
  async findAdminStanding(
    id: number,
  ): Promise<{ role: Role; customerId: number | null; others: number } | null> {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, customerId: true },
    });
    if (!target) return null;
    const others = await prisma.user.count({
      where: {
        id: { not: id },
        role: "super_admin",
        isActive: true,
        customerId: target.customerId,
      },
    });
    return { ...target, others };
  },

  async update(
    id: number,
    data: {
      role?: Role;
      teamId?: number | null;
      projectId?: number | null;
      availableForAssignment?: boolean;
      isActive?: boolean;
    },
    actor: AuthUser,
  ): Promise<UserDto | null> {
    return prisma.$transaction(async (tx) => {
      // Scope-check inside the tx: managers may only edit their department.
      const exists = await tx.user.findFirst({
        where: { id, ...scopeWhere(actor) },
      });
      if (!exists) return null;

      // A project is a routing target, so attaching a user to one must respect
      // the same tenant boundary as everything else: without this, a manager
      // could point their own user at another customer's project and have that
      // customer's caseworker start receiving the tickets.
      //
      // Goes through `projectScopeWhere` rather than restating its condition.
      // It used to spell out the isPlatformWide/customerId test inline — a
      // second copy that happened to agree, until soft delete gave the function
      // a third clause this copy would not have had. A deleted project would
      // have stayed selectable here, and the user attached to it would route
      // through a project no screen can show.
      if (data.projectId != null) {
        const project = await tx.project.findFirst({
          where: { AND: [{ id: data.projectId }, projectScopeWhere(actor)] },
          select: { id: true },
        });
        if (!project) throw BadRequest(`Unknown project #${data.projectId}`);
      }

      const updated = await tx.user.update({
        where: { id },
        data,
        include: userInclude,
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "user.update",
          entity: "user",
          entityId: id,
          meta: {
            role: data.role,
            teamId: data.teamId,
            projectId: data.projectId,
            availableForAssignment: data.availableForAssignment,
            // Retiring an account is the change most worth being able to point at
            // later, so it goes in the trail like every other field here.
            isActive: data.isActive,
          },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  /**
   * Replace the whole set of customers this user may reach beyond their own.
   *
   * A replace rather than add/remove endpoints, because reach is a statement
   * about a person ("covers Acme and Globex"), not a log of adjustments: sending
   * the intended set makes the request idempotent, leaves one audit row saying
   * what the answer became, and removes the window where two concurrent edits
   * each add half of what was meant.
   *
   * Unscoped by actor on purpose — the caller has already been checked by
   * `mayGrantReach`, which is platform-wide only, so there is no narrower scope
   * left to apply. The target still has to exist.
   */
  async setReach(
    id: number,
    customerIds: number[],
    actor: AuthUser,
  ): Promise<UserDto | null> {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) return null;

      // Delete-then-insert rather than a diff: the set is small, this is the
      // whole intent in two statements, and it cannot leave a stale row behind.
      await tx.userCustomer.deleteMany({ where: { userId: id } });
      if (customerIds.length > 0) {
        await tx.userCustomer.createMany({
          data: customerIds.map((customerId) => ({ userId: id, customerId })),
        });
      }

      const updated = await tx.user.findUniqueOrThrow({
        where: { id },
        include: userInclude,
      });
      await auditRepository.record(
        {
          userId: actor.id,
          action: "user.reach_set",
          entity: "user",
          entityId: id,
          // The resulting set, not the delta. Reading the trail back should
          // answer "what could they reach on that date" without replaying
          // every earlier row.
          meta: { customerIds },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  /** Which of these customer ids exist. Used to refuse a grant naming none. */
  async existingCustomerIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },

  /** The target's role, for the staff-only rule on granting reach. */
  async findRole(id: number): Promise<Role | null> {
    const row = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    return row?.role ?? null;
  },
};
