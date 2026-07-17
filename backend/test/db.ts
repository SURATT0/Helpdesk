import { prisma } from "../src/shared/db";
import { seedDatabase } from "../prisma/seed-fn";

// FK-safe wipe via TRUNCATE ... CASCADE; RESTART IDENTITY resets sequences so
// seeded explicit ticket ids (1042…) and fresh user ids stay deterministic.
const TABLES = [
  "attachments",
  "comments",
  "notifications",
  "audit_logs",
  "ticket_status_history",
  "refresh_tokens",
  "tickets",
  "categories",
  "users",
  "teams",
];

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await seedDatabase(prisma);
}

export { prisma };
