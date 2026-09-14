import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Every write behind the customers screen, called directly.
 *
 * Hiding a button is not a protection, and this file is what says so. The screen
 * decides what to render; these cases skip it entirely and ask the API, because
 * anybody can open a terminal.
 *
 * Kept apart from `tenant-authorization` — that file asks which TENANT a caller
 * may touch. This one asks whether they may perform the act at all, for the two
 * resources this screen owns, and it walks the full list rather than sampling:
 * a guard missing from one endpoint is not visible from testing another.
 */

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

/** The three tiers, by the names the product actually uses. */
const ACCOUNTS = {
  super_admin: "sam.rivera@acme.com", // platform-wide
  admin: "dana.reyes@acme.com", // "AGENT" in the brief
  user: "marcus.chen@acme.com", // "REQUESTER" in the brief
} as const;

type Tier = keyof typeof ACCOUNTS;

async function acme() {
  return prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
}
async function liveProject() {
  return prisma.project.findFirstOrThrow({
    where: { deletedAt: null, customer: { name: "Acme Corp" } },
  });
}

beforeEach(async () => {
  await resetDb();
});

/**
 * Every write this screen can make, and who the API lets through.
 *
 * `customer:write` still reaches admin — it did as a role comparison before the
 * grants became editable, and moving it must not quietly demote anyone — but the
 * permission is no longer the whole gate for CREATING one. That asks for
 * platform reach too, because a new tenant lands outside every reach and nothing
 * grants the creator access to it: an admin's create was a 201 for a row they
 * could not then see, and the screen walked them straight into its 404.
 * Renaming is unaffected, being scoped to what the caller already reaches.
 *
 * The `super_admin` tier here is sam.rivera, who is platform-wide. A super admin
 * who BELONGS to a customer is a different case and lives in
 * customer-crud.integration.test.ts, where the difference is the point.
 *
 * Everything else here is top tier: archiving ends a tenant, and the routing
 * table decides where a customer's work lands.
 */
const WRITES: Array<{
  what: string;
  allowed: Tier[];
  call: (token: string) => Promise<request.Response>;
}> = [
  {
    what: "create a customer",
    // Platform reach as well as `customer:write`, so admin no longer gets through.
    allowed: ["super_admin"],
    call: async (token) =>
      request(app)
        .post(`${API}/customers`)
        .set(bearer(token))
        .send({ name: `Authz probe ${Date.now()}${Math.random()}` }),
  },
  {
    what: "rename a customer",
    allowed: ["super_admin", "admin"],
    call: async (token) =>
      request(app)
        .patch(`${API}/customers/${(await acme()).id}`)
        .set(bearer(token))
        .send({ name: `Acme Corp ${Date.now()}` }),
  },
  {
    what: "read what archiving a customer would cost",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app)
        .get(`${API}/customers/${(await acme()).id}/archive-impact`)
        .set(bearer(token)),
  },
  {
    what: "archive a customer",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app).delete(`${API}/customers/${(await acme()).id}`).set(bearer(token)),
  },
  {
    what: "create a project",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app)
        .post(`${API}/projects`)
        .set(bearer(token))
        .send({ name: `Authz probe ${Date.now()}${Math.random()}`, customerId: (await acme()).id }),
  },
  {
    what: "rename a project",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app)
        .patch(`${API}/projects/${(await liveProject()).id}`)
        .set(bearer(token))
        .send({ description: "Edited by the authz suite." }),
  },
  {
    what: "read what archiving a project would cost",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app)
        .get(`${API}/projects/${(await liveProject()).id}/deletion-impact`)
        .set(bearer(token)),
  },
  {
    what: "archive a project",
    allowed: ["super_admin"],
    call: async (token) =>
      request(app).delete(`${API}/projects/${(await liveProject()).id}`).set(bearer(token)),
  },
];

describe("a requester is refused every write behind this screen", () => {
  it.each(WRITES)("cannot $what", async ({ call }) => {
    const res = await call(await login(ACCOUNTS.user));
    expect(res.status).toBe(403);
  });
});

describe("an agent is refused the ones above their tier", () => {
  it.each(WRITES.filter((w) => !w.allowed.includes("admin")))(
    "cannot $what",
    async ({ call }) => {
      const res = await call(await login(ACCOUNTS.admin));
      expect(res.status).toBe(403);
    },
  );

  it.each(WRITES.filter((w) => w.allowed.includes("admin")))(
    "can still $what",
    async ({ call }) => {
      // The half that keeps the refusals honest. Creating and renaming a
      // customer reached admin before the grants moved into the database, and a
      // move that quietly took it away would be a demotion dressed as a
      // refactor — which is exactly what happened once and was caught here.
      const res = await call(await login(ACCOUNTS.admin));
      expect(res.status).toBeLessThan(400);
    },
  );
});

describe("nothing is half-done when a write is refused", () => {
  it("creates no customer for a requester who asks directly", async () => {
    const name = "Authz probe — should not exist";
    await request(app)
      .post(`${API}/customers`)
      .set(bearer(await login(ACCOUNTS.user)))
      .send({ name })
      .expect(403);
    expect(await prisma.customer.count({ where: { name } })).toBe(0);
  });

  it("creates no project for an agent who asks directly", async () => {
    const name = "Authz probe — no project";
    await request(app)
      .post(`${API}/projects`)
      .set(bearer(await login(ACCOUNTS.admin)))
      .send({ name, customerId: (await acme()).id })
      .expect(403);
    expect(await prisma.project.count({ where: { name } })).toBe(0);
  });

  it("leaves a project live when an agent tries to archive it", async () => {
    const project = await liveProject();
    await request(app)
      .delete(`${API}/projects/${project.id}`)
      .set(bearer(await login(ACCOUNTS.admin)))
      .expect(403);
    const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.deletedAt).toBeNull();
  });
});

describe("reading is a separate question from writing", () => {
  it("still lets an agent read the routing table", async () => {
    // Why the write refusals above are defensible rather than merely strict: an
    // agent working cases needs to see where their queue's work comes from, so
    // `/projects` was deliberately kept when the screen moved.
    await request(app)
      .get(`${API}/projects`)
      .set(bearer(await login(ACCOUNTS.admin)))
      .expect(200);
  });

  it("still lets an agent read the customers they reach", async () => {
    const res = await request(app)
      .get(`${API}/customers`)
      .set(bearer(await login(ACCOUNTS.admin)))
      .expect(200);
    // Their own tenant, and only that — the picker's data, not the screen's.
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(["Acme Corp"]);
  });

  it("refuses a requester the routing table entirely", async () => {
    await request(app)
      .get(`${API}/projects`)
      .set(bearer(await login(ACCOUNTS.user)))
      .expect(403);
  });
});

describe("signing out is not a way in", () => {
  it("refuses every write with no token at all", async () => {
    for (const { what, call } of WRITES) {
      const res = await call("");
      expect([401, 403], what).toContain(res.status);
    }
  });
});
