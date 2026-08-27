import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://deskly:deskly@localhost:5432/deskly_test?schema=public";

/**
 * Runs once before the integration suite: make sure the test database exists,
 * then sync the Prisma schema onto it.
 *
 * `db push` computes a diff and refuses the ones it cannot express as a cast —
 * the three-value status migration renames the old enum for the history table,
 * which push wants to solve by dropping a NOT NULL column with data in it. The
 * test database is rebuilt from the seed before every test anyway, so pushing
 * onto a blank slate costs nothing and keeps the schema exactly what
 * schema.prisma says, migration-shaped or not.
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
