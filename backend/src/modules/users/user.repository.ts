import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import type { AuthUser } from "../../shared/auth";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";

/**
 * Row-level scope for the user directory (multi-tenant): admins see/manage
 * everyone across all customers; everyone else is limited to members of their
 * own customer (across all departments). A non-admin with no customer matches
 * nothing (defensive).
 */
function scopeWhere(actor: AuthUser): Prisma.UserWhereInput {
  if (actor.role === "admin") return {};
  if (actor.customerId == null) return { id: -1 };
  return { customerId: actor.customerId };
}

const userInclude = {
  team: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export type UserDto = {
  id: number;
  name: string;
  email: string;
  role: Role;
  team: { id: number; name: string } | null;
  createdAt: string;
};

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    team: row.team,
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
    data: { name: string },
    actorId: number,
  ): Promise<UserDto | null> {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({ where: { id } });
      if (!exists) return null;
      const updated = await tx.user.update({
        where: { id },
        data: { name: data.name },
        include: userInclude,
      });
      await auditRepository.record(
        {
          userId: actorId,
          action: "user.profile_update",
          entity: "user",
          entityId: id,
          meta: { name: data.name },
        },
        tx,
      );
      return toDto(updated);
    });
  },

  async update(
    id: number,
    data: { role?: Role; teamId?: number | null },
    actor: AuthUser,
  ): Promise<UserDto | null> {
    return prisma.$transaction(async (tx) => {
      // Scope-check inside the tx: managers may only edit their department.
      const exists = await tx.user.findFirst({
        where: { id, ...scopeWhere(actor) },
      });
      if (!exists) return null;
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
          meta: { role: data.role, teamId: data.teamId },
        },
        tx,
      );
      return toDto(updated);
    });
  },
};
