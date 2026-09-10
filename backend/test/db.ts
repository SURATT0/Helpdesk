import { prisma } from "../src/shared/db";
import { seedDatabase } from "../prisma/seed-fn";

// FK-safe wipe via TRUNCATE ... CASCADE; RESTART IDENTITY resets sequences so
// seeded explicit ticket ids (1042…) and fresh user ids stay deterministic.
const TABLES = [
  "attachments",
  "comments",
  "notifications",
  // Queued mail. Truncated with everything else so the idempotency constraint
  // (ticket, event, cause, recipient) starts clean each test — otherwise a row
  // left by the previous case makes the next one's enqueue a silent no-op.
  "email_outbox",
  // A customer's policy. Wiped with everything else so each test starts
  // unconfigured — a row left behind would silently change the next test's
  // rate limit and SLA window.
  "notification_settings",
  "audit_logs",
  // Cross-tenant grants. TRUNCATE ... CASCADE would take these with `users`
  // anyway, but named here like notification_settings above: a grant left
  // behind would silently widen the next test's reach, which is the one kind of
  // leftover that makes a scoping test pass for the wrong reason.
  "user_customers",
  "ticket_status_history",
  "refresh_tokens",
  // Single-use reset / confirmation tokens. Named here for the same reason as
  // `user_customers` above: a live token left behind by the previous case is the
  // kind of leftover that makes the next one pass for the wrong reason — a
  // single-use test in particular would find a second usable row waiting.
  "user_tokens",
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
