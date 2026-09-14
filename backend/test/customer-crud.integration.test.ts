import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STARTER_CATEGORY_NAMES } from "../src/modules/categories/category.code";
import { prisma, resetDb, tenantSuperAdmin } from "./db";

const app = createApp();
const API = "/api/v1";

const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer
// A super admin WITH a customer is no longer a seeded shape — every seeded one
// is platform-wide — so the cases that need one build it. See `tenantSuperAdmin`.
const ACME_ADMIN = "dana.reyes@acme.com"; // admin
const ACME_USER = "marcus.chen@acme.com"; // requester

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status, `login ${email}`).toBe(200);
  return res.body.data.accessToken as string;
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const create = (token: string, name: string) =>
  request(app).post(`${API}/customers`).set(bearer(token)).send({ name });

beforeEach(async () => {
  await resetDb();
  // resetDb does not truncate `customers` — the seed upserts them and renumbering
  // every tenant id would break the rest of the suite. So this file removes only
  // what it made, matched by a prefix nothing else uses.
  await prisma.customer.deleteMany({ where: { name: { startsWith: "CRUD probe" } } });
});

describe("creating a customer", () => {
  it("puts the new tenant in its creator's own list, at once", async () => {
    const platform = await login(PLATFORM);
    const res = await create(platform, "CRUD probe — Initech");
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("CRUD probe — Initech");
    // Empty of work, but NOT of categories: a customer is created with the
    // starter set in the same transaction, which is what makes its ticket form
    // usable on day one. Reported, and — since they no longer block an archive —
    // reported as context rather than as an obstacle.
    expect(res.body.data.counts).toEqual({
      projects: 0,
      tickets: 0,
      users: 0,
      categories: STARTER_CATEGORY_NAMES.length,
    });

    // The half that used to be missing. A 201 for a row the caller cannot then
    // see is not a create, it is a trap: the screen sends them to the new
    // customer's page and the page answers 404.
    const list = await request(app).get(`${API}/customers`).set(bearer(platform));
    const names = (list.body.data as { name: string }[]).map((c) => c.name);
    expect(names).toContain("CRUD probe — Initech");
  });

  it("is refused to an admin, who cannot see what they would make", async () => {
    // `customer:write` is not enough on its own any more. An admin is never
    // platform-wide, and nothing grants a creator reach into what they created
    // (`mayGrantReach` is platform-wide only, deliberately stricter than
    // creating) — so an admin's tenant landed outside everybody's reach and
    // somebody else had to go and find it. A 403 says that up front.
    const res = await create(await login(ACME_ADMIN), "CRUD probe — Initech");
    expect(res.status).toBe(403);
  });

  it("is refused to a super admin who belongs to a customer", async () => {
    // The reported bug, pinned. Role and reach are separate axes: this one holds
    // the top role and every permission with it, and is still scoped to Acme, so
    // a tenant they create is one they cannot list, open or rename.
    const confined = await tenantSuperAdmin("Acme Corp");
    const res = await create(await login(confined.email), "CRUD probe — Scoped");
    expect(res.status).toBe(403);

    // And nothing was written on the way to the refusal.
    const row = await prisma.customer.findFirst({
      where: { name: "CRUD probe — Scoped" },
    });
    expect(row).toBeNull();
  });

  it("is refused to a requester", async () => {
    const res = await create(await login(ACME_USER), "CRUD probe — Nope");
    expect(res.status).toBe(403);
  });

  it("refuses a name already taken", async () => {
    const res = await create(await login(PLATFORM), "Acme Corp");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("already called");
  });

  it("says so when the namesake is ARCHIVED, rather than just refusing", async () => {
    // A live clash and an archived one need different answers: the second is
    // solved by restoring a row the person cannot see in any list, and "name
    // taken" would send them hunting for it.
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Gone");
    await prisma.customer.update({
      where: { id: made.body.data.id },
      data: { deletedAt: new Date() },
    });

    const again = await create(platform, "CRUD probe — Gone");
    expect(again.status).toBe(400);
    expect(again.body.error.message).toContain("archived");
  });
});

describe("archiving a customer", () => {
  it("is refused to an admin", async () => {
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(await login(ACME_ADMIN)));
    expect(res.status).toBe(403);
  });

  it("is refused to a super admin archiving their OWN customer", async () => {
    // Row scope would have allowed this one — Acme is inside Morgan's reach —
    // so the platform check is what stops it. Ending a tenant is platform work,
    // and the company you belong to is the last one you should be able to end.
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const confined = await tenantSuperAdmin("Acme Corp");
    const res = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(await login(confined.email)));
    expect(res.status).toBe(403);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: acme.id } });
    expect(after.deletedAt).toBeNull();
  });

  it("refuses while the tenant still carries work, naming what and how much", async () => {
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(await login(PLATFORM)));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CUSTOMER_NOT_EMPTY");
    // The message is the caller's next step, so it has to say what is in the way.
    expect(res.body.error.message).toMatch(/ticket|project|user/);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: acme.id } });
    expect(after.deletedAt).toBeNull();
  });

  it("archives an empty one, and it leaves every list", async () => {
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Empty");
    const id = made.body.data.id as number;

    const before = await request(app).get(`${API}/customers`).set(bearer(platform));
    expect((before.body.data as { id: number }[]).map((c) => c.id)).toContain(id);

    const archived = await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform));
    expect(archived.status).toBe(204);

    const after = await request(app).get(`${API}/customers`).set(bearer(platform));
    expect((after.body.data as { id: number }[]).map((c) => c.id)).not.toContain(id);

    // Archived, not gone: the row survives because its id is on everything it
    // ever had.
    const row = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBeGreaterThan(0);
  });

  it("counts only OPEN tickets, so a finished tenant can be closed", async () => {
    // Counting closed tickets would make archiving impossible forever — and a
    // tenant whose work is done is exactly the one you archive.
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Finished");
    const id = made.body.data.id as number;
    const requester = await prisma.user.findFirstOrThrow({ where: { role: "user" } });
    // The new tenant's OWN category — created with it, which is the starter set
    // this same suite relies on elsewhere. A category from any other customer
    // would be refused by the composite foreign key rather than counted.
    const category = await prisma.category.findFirstOrThrow({
      where: { customerId: id },
    });
    await prisma.ticket.create({
      data: {
        subject: "closed work",
        description: "x",
        status: "closed",
        closedAt: new Date(),
        requesterId: requester.id,
        categoryId: category.id,
        customerId: id,
      },
    });

    // The closed ticket STAYS, and so do the categories it points at. That is
    // the case worth pinning: a soft delete leaves every row and every foreign
    // key where it is, so there is nothing to tidy first.
    const res = await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform));
    expect(res.status).toBe(204);

    const ticketStillThere = await prisma.ticket.count({ where: { customerId: id } });
    expect(ticketStillThere).toBe(1);
    const categoriesStillThere = await prisma.category.count({
      where: { customerId: id },
    });
    expect(categoriesStillThere).toBe(STARTER_CATEGORY_NAMES.length);
  });

  it("archives a brand-new tenant, starter categories and all", async () => {
    // The regression this replaced: categories were counted by the guard, every
    // customer is created with the starter set, and nothing in the product
    // removes one — so no tenant the app had ever made could be archived. The
    // count is still reported, because the dialog is a fair place to say what is
    // coming along; it is simply not in the way.
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Categorised");
    const id = made.body.data.id as number;

    const impact = await request(app)
      .get(`${API}/customers/${id}/archive-impact`)
      .set(bearer(platform))
      .expect(200);
    expect(impact.body.data).toMatchObject({
      projects: 0,
      tickets: 0,
      users: 0,
      categories: STARTER_CATEGORY_NAMES.length,
    });

    await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform))
      .expect(204);

    const row = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    // Archived, not emptied — the categories are still owned by the row.
    expect(
      await prisma.category.count({ where: { customerId: id } }),
    ).toBe(STARTER_CATEGORY_NAMES.length);
  });

  it("never blames categories when it does refuse", async () => {
    // A refusal names what a person can actually act on. Acme has real work, so
    // this one is refused for tickets — and must not mention the categories it
    // also has, because nothing in the product can remove them and sending
    // somebody after them is sending them nowhere.
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(await login(PLATFORM)));
    expect(res.status).toBe(409);
    expect(res.body.error.message).not.toMatch(/categor/i);
    // Still carried in the details, for the dialog to show alongside.
    expect(res.body.error.details.categories).toBeGreaterThan(0);
  });

  it("shows the dialog the same numbers the guard refuses on", async () => {
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const platform = await login(PLATFORM);
    const impact = await request(app)
      .get(`${API}/customers/${acme.id}/archive-impact`)
      .set(bearer(platform));
    expect(impact.status).toBe(200);
    expect(impact.body.data.tickets).toBeGreaterThan(0);

    const refused = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(platform));
    expect(refused.body.error.message).toContain(String(impact.body.data.tickets));
  });

  it("does not tell someone who may not archive how much a tenant carries", async () => {
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .get(`${API}/customers/${acme.id}/archive-impact`)
      .set(bearer(await login(ACME_ADMIN)));
    expect(res.status).toBe(403);
  });
});

describe("renaming a customer", () => {
  it("is scoped: a customer's own super admin cannot rename another tenant", async () => {
    const globex = await prisma.customer.findFirstOrThrow({
      where: { name: "Globex Inc" },
    });
    const confined = await tenantSuperAdmin("Acme Corp");
    const res = await request(app)
      .patch(`${API}/customers/${globex.id}`)
      .set(bearer(await login(confined.email)))
      .send({ name: "CRUD probe — hijacked" });
    // 404 rather than 403: a tenant they cannot reach must not be confirmed to exist.
    expect(res.status).toBe(404);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: globex.id } });
    expect(after.name).toBe("Globex Inc");
  });

  it("records both names, so the trail is legible", async () => {
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Before");
    const id = made.body.data.id as number;
    await request(app)
      .patch(`${API}/customers/${id}`)
      .set(bearer(platform))
      .send({ name: "CRUD probe — After" });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "customer.rename", entityId: id },
      orderBy: { id: "desc" },
    });
    expect(entry.meta).toEqual({
      from: "CRUD probe — Before",
      to: "CRUD probe — After",
    });
  });
});
