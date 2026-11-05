/**
 * Loads and applies `config/services.json` — the public-intake form's
 * service dropdown — to the `service_catalog` table.
 *
 * Exported as a plain function (`seedServiceCatalog`) so it can be called
 * from two places that need it for different reasons: `seed-fn.ts`'s full
 * demo reseed (dev/test databases, which get truncated and need this back
 * every time — see that file's own note on why `resetSystemIntakeTenant` and
 * `seedRolePermissions` do the same thing), and the standalone CLI below
 * (`npm run db:seed:services`), which is what a real deployment runs after
 * editing the config file — see docs/adding-a-service.md. The demo reseed
 * must never be what puts a new service live in production, the same reason
 * `create-super-admin.ts` is a separate script from the main seed.
 *
 * Idempotent both ways: upserts by `code`, and a code REMOVED from the file
 * is retired (`active: false`), never deleted — an old ticket's
 * `serviceCode` still points at it and needs a label to render.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const CONFIG_PATH = path.join(__dirname, "..", "config", "services.json");

const serviceSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  desc: z.string().min(1),
  active: z.boolean(),
});

const groupSchema = z.object({
  group: z.string().min(1),
  order: z.number().int(),
  services: z.array(serviceSchema).min(1),
});

const configSchema = z.array(groupSchema).min(1);

export type ServiceConfig = z.infer<typeof configSchema>;

/**
 * A code duplicated across two groups would upsert twice with different
 * group/order, and the second write silently wins — refused instead. Run on
 * every config `seedServiceCatalog` sees, not just one loaded from the file:
 * an injected config (tests; conceivably a future admin-editable source) can
 * be just as malformed as a hand-edited file, and this is the invariant the
 * retire-on-removal logic depends on, not a one-time file-format check.
 */
function checkNoDuplicateCodes(config: ServiceConfig): void {
  const seen = new Set<string>();
  for (const g of config) {
    for (const s of g.services) {
      if (seen.has(s.code)) {
        throw new Error(`Duplicate service code "${s.code}"`);
      }
      seen.add(s.code);
    }
  }
}

/**
 * Read and validate the config file. Thrown errors name the exact problem
 * (Zod's own message) rather than letting a malformed edit surface as a
 * confusing database error three calls later — the file is meant to be
 * hand-edited by someone who does not read this code.
 */
export function loadServiceConfig(): ServiceConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = configSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `config/services.json is invalid: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  checkNoDuplicateCodes(parsed.data);
  return parsed.data;
}

export type SeedServiceCatalogResult = { upserted: number; retired: number };

/**
 * `config` is injectable so tests can exercise upsert/retire/validation
 * behaviour against an in-memory shape instead of editing the real
 * config/services.json — the default (omitted) reads that file, which is
 * what every real call site (the CLI below, seed-fn.ts) relies on.
 */
export async function seedServiceCatalog(
  prisma: PrismaClient,
  config: ServiceConfig = loadServiceConfig(),
): Promise<SeedServiceCatalogResult> {
  checkNoDuplicateCodes(config);
  const groups = config;
  const seenCodes = new Set<string>();

  for (const g of groups) {
    for (const s of g.services) {
      seenCodes.add(s.code);
      await prisma.serviceCatalog.upsert({
        where: { code: s.code },
        update: { label: s.label, desc: s.desc, group: g.group, order: g.order, active: s.active },
        create: { code: s.code, label: s.label, desc: s.desc, group: g.group, order: g.order, active: s.active },
      });
    }
  }

  // `notIn: []` matches EVERY row (Prisma/SQL: "not in the empty set" is true
  // for anything) — the config schema above already requires at least one
  // group with at least one service, so this can only be empty if that
  // validation was bypassed, but the guard costs nothing and the failure
  // mode it prevents (retiring the whole catalog) is not a small one.
  if (seenCodes.size === 0) {
    throw new Error("config/services.json named no services — refusing to retire the whole catalog");
  }

  const retired = await prisma.serviceCatalog.updateMany({
    where: { code: { notIn: [...seenCodes] }, active: true },
    data: { active: false },
  });

  return { upserted: seenCodes.size, retired: retired.count };
}

// Only run as a CLI entry point (`npm run db:seed:services`), not when
// imported by seed-fn.ts — `require.main === module` is the standard
// CommonJS way to tell the two apart.
if (require.main === module) {
  const prisma = new PrismaClient();
  seedServiceCatalog(prisma)
    .then((result) => {
      console.log(
        `Service catalog: ${result.upserted} active, ${result.retired} retired this run.`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
