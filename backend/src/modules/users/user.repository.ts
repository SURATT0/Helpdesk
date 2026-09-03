import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import type { Lang } from "../../shared/i18n";
import { isPlatformWide, type AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { BadRequest } from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { projectScopeWhere } from "../projects/project.scope";
import { ACTIVE_STATUSES } from "../tickets/ticket.validators";

/**
 * Row-level scope for the user directory (multi-tenant): admins see/manage
 * everyone across all customers; everyone else is limited to members of their
 * own customer (across all departments). Staff with no customer who are not
 * platform-wide match nothing (defensive).
 */
function scopeWhere(actor: AuthUser): Prisma.UserWhereInput {
  if (isPlatformWide(actor)) return {};
  if (actor.customerId == null) return { id: -1 };
  return { customerId: actor.customerId };
}

const userInclude = {
  team: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export type UserDto = {
  id: number;
  name: string;
  email: string;
  role: Role;
  team: { id: number; name: string } | null;
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
  createdAt: string;
};

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    team: row.team,
    project: row.project,
    availableForAssignment: row.availableForAssignment,
    isActive: row.isActive,
    language: row.language,
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
          : { customerId: actor.customerId ?? -1 }),
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
};
