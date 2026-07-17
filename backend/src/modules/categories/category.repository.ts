import { prisma } from "../../shared/db";

export type Category = { id: number; name: string; defaultTeamId: number | null };

/** The only categories layer that talks to the database. */
export const categoryRepository = {
  findMany(): Promise<Category[]> {
    return prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultTeamId: true },
    });
  },

  findById(id: number) {
    return prisma.category.findUnique({ where: { id } });
  },
};
