import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import {
  loadServiceConfig,
  seedServiceCatalog,
  type ServiceConfig,
} from "../prisma/seed-service-catalog";
import { prisma, resetDb } from "./db";

const app = createApp();
const API = "/api/v1";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * The service catalog: a single-source-of-truth config file applied to the
 * database, never the other way around. `resetDb()` already runs
 * `seedServiceCatalog` with the REAL config/services.json (see seed-fn.ts),
 * so every test here starts from the real 12 services and exercises further
 * changes through an injected config, never by editing the real file.
 */

const svc = (code: string, active = true) => ({
  code,
  label: `Label for ${code}`,
  desc: `Description for ${code}`,
  active,
});

const oneGroupConfig = (codes: string[], activeOverrides: Record<string, boolean> = {}): ServiceConfig => [
  {
    group: "Test Group",
    order: 1,
    services: codes.map((c) => svc(c, activeOverrides[c] ?? true)),
  },
];

beforeEach(async () => {
  await resetDb();
});

describe("the real config/services.json", () => {
  it("parses cleanly and names exactly the 12 services the form used to hard-code", () => {
    const config = loadServiceConfig();
    const codes = config.flatMap((g) => g.services.map((s) => s.code)).sort();
    expect(codes).toEqual(
      [
        "blue-digital",
        "blue-document",
        "blue-develop",
        "blue-swap",
        "blue-site",
        "blue-shield",
        "blue-box",
        "blue-file",
        "blue-destroys",
        "rpa-license",
        "rpa-consult",
        "rpa-implement",
      ].sort(),
    );
  });

  it("is what resetDb() already applied, with every entry active", async () => {
    const rows = await prisma.serviceCatalog.findMany();
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.active)).toBe(true);
  });
});

describe("adding a service", () => {
  it("appears in the catalog once seeded, with its group and order", async () => {
    const before = await prisma.serviceCatalog.count();
    const result = await seedServiceCatalog(
      prisma,
      oneGroupConfig(["blue-digital", "new-service"]),
    );
    expect(result.upserted).toBe(2);

    const row = await prisma.serviceCatalog.findUniqueOrThrow({
      where: { code: "new-service" },
    });
    expect(row.label).toBe("Label for new-service");
    expect(row.group).toBe("Test Group");
    expect(row.order).toBe(1);
    expect(row.active).toBe(true);
    // Existing services not named in THIS call are retired, not deleted --
    // see the "removing a service" describe block below for that behaviour
    // in isolation. Row count grows by exactly the genuinely new one here
    // because "blue-digital" was already present.
    expect(await prisma.serviceCatalog.count()).toBe(before + 1);
  });
});

describe("removing a service from the config", () => {
  it("retires it (active: false) rather than deleting the row", async () => {
    const before = await prisma.serviceCatalog.count();
    // A config naming every REAL service except one.
    const config = loadServiceConfig();
    const allCodes = config.flatMap((g) => g.services.map((s) => s.code));
    const remaining = allCodes.filter((c) => c !== "rpa-license");
    const result = await seedServiceCatalog(prisma, oneGroupConfig(remaining));

    expect(result.retired).toBe(1);
    // No row disappeared.
    expect(await prisma.serviceCatalog.count()).toBe(before);

    const retired = await prisma.serviceCatalog.findUniqueOrThrow({
      where: { code: "rpa-license" },
    });
    expect(retired.active).toBe(false);
    // Its label survives, because an old ticket referencing this code still
    // needs one to render.
    expect(retired.label).toBeTruthy();
  });

  it("reactivates a retired code if it reappears in a later config", async () => {
    const config = loadServiceConfig();
    const allCodes = config.flatMap((g) => g.services.map((s) => s.code));
    await seedServiceCatalog(
      prisma,
      oneGroupConfig(allCodes.filter((c) => c !== "rpa-license")),
    );
    expect(
      (await prisma.serviceCatalog.findUniqueOrThrow({ where: { code: "rpa-license" } })).active,
    ).toBe(false);

    await seedServiceCatalog(prisma, oneGroupConfig(allCodes));
    expect(
      (await prisma.serviceCatalog.findUniqueOrThrow({ where: { code: "rpa-license" } })).active,
    ).toBe(true);
  });

  it("never retires everything just because an empty config slipped through validation", async () => {
    const before = await prisma.serviceCatalog.findMany();
    await expect(seedServiceCatalog(prisma, [])).rejects.toThrow(/no services/i);
    const after = await prisma.serviceCatalog.findMany();
    expect(after).toEqual(before);
  });
});

describe("running the seed twice", () => {
  it("produces no duplicate rows and the same data both times", async () => {
    const config = oneGroupConfig(["blue-digital", "blue-document"]);
    await seedServiceCatalog(prisma, config);
    const before = await prisma.serviceCatalog.count();
    await seedServiceCatalog(prisma, config);
    expect(await prisma.serviceCatalog.count()).toBe(before);

    // Same content both times -- `updatedAt` legitimately moves on every
    // upsert (Prisma's own @updatedAt, even when nothing else changed), so
    // that column is deliberately excluded rather than asserted identical.
    const rows = await prisma.serviceCatalog.findMany({
      orderBy: { code: "asc" },
      select: { code: true, label: true, desc: true, group: true, order: true, active: true },
    });
    expect(rows.find((r) => r.code === "blue-digital")).toEqual({
      code: "blue-digital",
      label: "Label for blue-digital",
      desc: "Description for blue-digital",
      group: "Test Group",
      order: 1,
      active: true,
    });
  });
});

describe("config validation", () => {
  it("refuses a duplicate code with a clear message", async () => {
    const badConfig: ServiceConfig = [
      { group: "A", order: 1, services: [svc("dup")] },
      { group: "B", order: 2, services: [svc("dup")] },
    ];
    await expect(seedServiceCatalog(prisma, badConfig)).rejects.toThrow(/duplicate/i);
  });
});

describe("GET /service-catalog — the ticket list filter's picker data", () => {
  it("lists every seeded entry, including retired ones, to a signed-in user", async () => {
    await seedServiceCatalog(
      prisma,
      oneGroupConfig(["blue-digital"], { "blue-digital": false }),
    );
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/service-catalog`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<{ code: string; active: boolean }>).find(
      (r) => r.code === "blue-digital",
    );
    expect(row).toBeTruthy();
    expect(row?.active).toBe(false);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).get(`${API}/service-catalog`);
    expect(res.status).toBe(401);
  });
});
