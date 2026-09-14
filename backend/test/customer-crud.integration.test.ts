import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STARTER_CATEGORY_NAMES } from "../src/modules/categories/category.code";
import { prisma, resetDb } from "./db";

const app = createApp();
const API = "/api/v1";

const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer
const ACME_SUPER = "morgan.lee@acme.com"; // super_admin WITH a customer
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

/**
 * Strip a tenant's categories so it can be archived at all.
 *
 * Not a step anybody can take in the product: nothing removes a category, and a
 * customer is created with the starter set, so a tenant that still has them can
 * never be archived. That is the agreed behaviour rather than a gap these tests
 * are working around — and doing it here in raw Prisma is what keeps that
 * visible. When a real removal path exists, these two lines become a call to it.
 */
async function stripCategories(customerId: number): Promise<void> {
  await prisma.category.deleteMany({ where: { customerId } });
}

describe("creating a customer", () => {
  it("is open to an admin", async () => {
    // As agreed: `admin` and above. Deliberately wider than granting reach,
    // and safe because it confers none — an admin who creates a tenant cannot
    // see into it and cannot grant themselves the reach to.
    const res = await create(await login(ACME_ADMIN), "CRUD probe — Initech");
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("CRUD probe — Initech");
    // Empty of work, but NOT of categories: a customer is created with the
    // starter set in the same transaction, which is what makes its ticket form
    // usable on day one — and, since categories are counted, what stops it being
    // archived until somebody can remove them.
    expect(res.body.data.counts).toEqual({
      projects: 0,
      tickets: 0,
      users: 0,
      categories: STARTER_CATEGORY_NAMES.length,
    });
  });

  it("does not let the creator see into it", async () => {
    // The reason creating is safe at admin level. Reach is a separate axis, so
    // the new tenant does not appear in their own list.
    const dana = await login(ACME_ADMIN);
    const created = await create(dana, "CRUD probe — Unreachable");
    expect(created.status).toBe(201);

    const list = await request(app).get(`${API}/customers`).set(bearer(dana));
    const names = (list.body.data as { name: string }[]).map((c) => c.name);
    expect(names).not.toContain("CRUD probe — Unreachable");
    expect(names).toEqual(["Acme Corp"]);
  });

  it("is refused to a requester", async () => {
    const res = await create(await login(ACME_USER), "CRUD probe — Nope");
    expect(res.status).toBe(403);
  });

  it("refuses a name already taken", async () => {
    const res = await create(await login(ACME_ADMIN), "Acme Corp");
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
  it("is refused to an admin, who may create one", async () => {
    // The asymmetry, on purpose: a mistaken create leaves an empty row nobody
    // has to care about; an archive removes a company from every picker.
    const acme = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .delete(`${API}/customers/${acme.id}`)
      .set(bearer(await login(ACME_ADMIN)));
    expect(res.status).toBe(403);
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

    await stripCategories(id);
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

    // The ticket has to go before the categories it points at.
    await prisma.ticket.deleteMany({ where: { customerId: id } });
    await stripCategories(id);

    const res = await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform));
    expect(res.status).toBe(204);
  });

  it("refuses while the tenant still has categories, and says how many", async () => {
    // The agreed consequence of counting them, pinned so it cannot be softened
    // by accident: a customer is created with the starter set, nothing in the
    // product removes a category, so a brand-new tenant with no work at all
    // still cannot be archived.
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

    const refused = await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform));
    expect(refused.status).toBe(409);
    // The number, not just a refusal — it is the only thing that tells a reader
    // why an apparently empty tenant will not archive.
    expect(refused.body.error.message).toContain(
      String(STARTER_CATEGORY_NAMES.length),
    );
    expect(refused.body.error.message).toMatch(/categor/i);

    // Still live.
    const row = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
  });

  it("archives once the categories are gone, which is the only way through", async () => {
    const platform = await login(PLATFORM);
    const made = await create(platform, "CRUD probe — Decategorised");
    const id = made.body.data.id as number;

    await stripCategories(id);
    await request(app)
      .delete(`${API}/customers/${id}`)
      .set(bearer(platform))
      .expect(204);
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
    const res = await request(app)
      .patch(`${API}/customers/${globex.id}`)
      .set(bearer(await login(ACME_SUPER)))
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
