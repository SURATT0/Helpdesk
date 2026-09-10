/**
 * Bootstrap the first platform-wide super admin.
 *
 * Separate from the seed on purpose, and not imported by it. The seed writes a
 * DEMO desk — sixteen people who all share one published password — and running
 * it against a real deployment must never be the thing that creates the account
 * holding every permission. This script creates exactly one account and nothing
 * else, so it can be run on a production database without writing demo data into
 * it.
 *
 * The password is read from the environment and never appears in this file, nor
 * in the repository, nor in the process arguments (which are visible to anyone
 * who can run `ps`). Run it as:
 *
 *   SUPERADMIN_EMAIL=you@example.com \
 *   SUPERADMIN_NAME="Your Name" \
 *   SUPERADMIN_PASSWORD='...' \
 *   npm run db:create-super-admin
 *
 * Platform-wide reach comes from `customerId: null` TOGETHER with the top role —
 * see `isPlatformWide`. Neither half grants it alone, which is why this script
 * sets both explicitly rather than leaving the customer unset and hoping.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/auth.password";

const prisma = new PrismaClient();

/**
 * The shortest password this will accept.
 *
 * A floor, not a policy: this account is the one that can reach every tenant, and
 * a bootstrap script is the wrong place to be lenient. The interactive rules that
 * apply to everyone else live with the registration validator.
 */
const MIN_PASSWORD_LENGTH = 12;

function required(name: string): string {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    throw new Error(
      `${name} is not set. See the comment at the top of this file for how to run it.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const email = required("SUPERADMIN_EMAIL").trim().toLowerCase();
  const name = required("SUPERADMIN_NAME").trim();
  const password = required("SUPERADMIN_PASSWORD");

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  // Refuse rather than update. If this address already has an account, the
  // operator is either running the script twice or pointing it at the wrong
  // database, and quietly resetting a live administrator's password — or
  // promoting an existing ordinary user to platform-wide reach — is the worst
  // possible response to either mistake.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, role: true },
  });
  if (existing) {
    throw new Error(
      `${email} already exists (id ${existing.id}, role ${existing.role}). ` +
        `Refusing to modify it — change the address, or promote the account by hand if that is what you meant.`,
    );
  }

  const created = await prisma.user.create({
    data: {
      name,
      email,
      role: "super_admin",
      // Both halves of platform-wide reach, stated together — see the file header.
      customerId: null,
      passwordHash: await hashPassword(password),
      status: "active",
      // Whoever runs this script owns the address by definition; there is no
      // second party to mail a confirmation to, and an unverified bootstrap
      // account could not sign in to verify itself.
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });

  console.log(
    `Created platform-wide super admin ${created.email} (id ${created.id}).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
