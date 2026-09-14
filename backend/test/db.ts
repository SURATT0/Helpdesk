import { prisma } from "../src/shared/db";
import { seedDatabase, seedPassword } from "../prisma/seed-fn";
import { hashPassword } from "../src/modules/auth/auth.password";

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

/**
 * A super admin who BELONGS to a customer — the top role INSIDE one tenant.
 *
 * The seed used to hand out two of these (Morgan in Acme, Nadia in Globex) and
 * no longer does: a super admin who cannot see the customer they just created
 * reads as a broken product, so the seeded ones belong to no tenant now and are
 * platform-wide. The STATE is still reachable — nothing in the schema or the
 * service layer forbids `role: super_admin` with a `customerId` — and it is the
 * state a whole class of guards exists to confine, so it still has to be tested.
 * This is where the suites that need it get one.
 *
 * Built here rather than copied into seven files: the shape has to match what
 * the seed makes (same password hash, `status: "active"`, verified address) or
 * `login()` fails and the case reads as a scoping bug instead of a fixture one.
 * Hashed through `hashPassword`, the same function the login flow verifies
 * against, so the cost factor cannot drift apart from the app's.
 *
 * Call it after `resetDb()`; the truncation takes it with everything else.
 */
export async function tenantSuperAdmin(customerName: string): Promise<{
  id: number;
  email: string;
  customerId: number;
}> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: customerName },
  });
  // Keyed on the customer so a suite can make one per tenant — the two-tenant
  // cases need exactly that, and a fixed address would collide on the second.
  const email = `tenant.super.${customer.id}@example.test`;
  const row = await prisma.user.upsert({
    where: { email },
    update: { customerId: customer.id, role: "super_admin", status: "active" },
    create: {
      name: `Tenant Super ${customer.id}`,
      email,
      role: "super_admin",
      customerId: customer.id,
      passwordHash: await hashPassword(seedPassword()),
      status: "active",
      emailVerifiedAt: new Date(),
    },
  });
  return { id: row.id, email, customerId: customer.id };
}

export { prisma };
