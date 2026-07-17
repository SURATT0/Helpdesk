import { Prisma } from "@prisma/client";
import type { Role } from "../../shared/domain";
import { prisma } from "../../shared/db";
import { auditRepository } from "../audit/audit.repository";

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
  async findMany(): Promise<UserDto[]> {
    const rows = await prisma.user.findMany({
      include: userInclude,
      orderBy: { name: "asc" },
    });
    return rows.map(toDto);
  },

  async findById(id: number): Promise<UserDto | null> {
    const row = await prisma.user.findUnique({
      where: { id },
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
