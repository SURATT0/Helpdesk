import "dotenv/config";
import { defineConfig } from "vitest/config";

// Integration tests run against a dedicated test database so they never touch
// dev data. TEST_DATABASE_URL is set here for the test workers BEFORE the app
// (and its Prisma client) load; dotenv won't override an already-set var.
const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://deskly:deskly@localhost:5432/deskly_test?schema=public";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: testDbUrl,
      NODE_ENV: "production", // plain pino (no pretty-transport worker)
      LOG_LEVEL: "silent",
      AUTH_RATE_LIMIT: "1000", // suite logs in many times; don't trip the limiter
    },
    fileParallelism: false, // one shared DB — run files serially
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
