import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://deskly:deskly@localhost:5432/deskly_test?schema=public";

/**
 * Runs once before the integration suite: rebuild the test database from the
 * MIGRATIONS, the same way the real one is built.
 *
 * This used to be `prisma db push`, which applies schema.prisma directly. That
 * was fine while the schema said everything — and stopped being fine the moment
 * the migrations carried objects Prisma has no syntax for. The two partial
 * unique indexes (live project names, shared category names) exist only in the
 * migration SQL, so a pushed database silently lacked them: the suite would
 * have passed a write that production refuses, which is worse than not testing
 * it at all.
 *
 * Dropped and recreated rather than migrated in place, because `migrate deploy`
 * needs either a matching `_prisma_migrations` history or an empty database,
 * and a database left behind by the old `db push` has neither. A blank slate
 * each run costs a couple of seconds and removes the whole class of "works on
 * my machine because my test DB is older".
 */
export default async function setup() {
  const adminUrl = testDbUrl.replace(/\/deskly_test(\?|$)/, "/postgres$1");
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    // Terminate anything still holding the database — a previous run's client
    // that has not been collected yet will otherwise make DROP hang.
    await admin.$executeRawUnsafe(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'deskly_test' AND pid <> pg_backend_pid()",
    );
    await admin.$executeRawUnsafe("DROP DATABASE IF EXISTS deskly_test");
    await admin.$executeRawUnsafe("CREATE DATABASE deskly_test");
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDbUrl },
  });
}
