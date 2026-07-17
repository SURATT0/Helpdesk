import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * Single PrismaClient for the whole app. This — plus the repositories and the
 * seed script — is the ONLY place allowed to import Prisma; services and
 * controllers depend on the repository layer, never on the ORM. A globalThis
 * cache prevents connection storms from tsx-watch hot reloads in dev.
 */
const isDev = env.nodeEnv !== "production";

const createClient = () =>
  new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
  });

// Preserve the log-typed client so `$on` events stay typed through the cache.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

prisma.$on("warn", (e) => logger.warn({ prisma: e }, e.message));
prisma.$on("error", (e) => logger.error({ prisma: e }, e.message));
if (isDev) {
  prisma.$on("query", (e) =>
    logger.debug({ durationMs: e.duration }, e.query),
  );
  globalForPrisma.prisma = prisma;
}
