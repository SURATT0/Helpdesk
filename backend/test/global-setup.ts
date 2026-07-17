import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://deskly:deskly@localhost:5432/deskly_test?schema=public";

/**
 * Runs once before the integration suite: make sure the test database exists,
 * then sync the Prisma schema onto it (no migration history needed for tests).
 */
export default async function setup() {
  const adminUrl = testDbUrl.replace(/\/deskly_test(\?|$)/, "/postgres$1");
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe("CREATE DATABASE deskly_test");
  } catch {
    // already exists — fine
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDbUrl },
  });
}
