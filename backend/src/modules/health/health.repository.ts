import { prisma } from "../../shared/db";

export const healthRepository = {
  /** Cheap round-trip to confirm the database is reachable. */
  async ping(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  },
};
