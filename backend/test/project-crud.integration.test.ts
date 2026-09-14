import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Projects under a customer: naming them, and retiring them.
 *
 * The screen that drives this binds the customer for you — there is no picker,
 * because the person is already looking at the customer. These cases check the
 * half that matters regardless of what the screen does: that the server files
 * the project under the customer it was told, refuses a name that customer
 * already uses, allows the same name under a different one, and will not archive
 * a project out from under live work.
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

const SUPER_ADMIN = "sam.rivera@acme.com"; // platform-wide
const AGENT = "dana.reyes@acme.com";
const REQUESTER = "marcus.chen@acme.com";

async function customers() {
  const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  const globex = await prisma.customer.findFirstOrThrow({
    where: { name: "Globex Inc" },
  });
  return { acme, globex };
}

beforeEach(async () => {
  await resetDb();
});

describe("creating a project under a customer", () => {
  it("files it under the customer it was given, not the actor's own", async () => {
    const { globex } = await customers();
    const sam = await login(SUPER_ADMIN);

    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Globex Phase Two", customerId: globex.id });

    expect(res.status).toBe(201);
    expect(res.body.data.customerId).toBe(globex.id);
    // And on the row, not just in the response.
    const row = await prisma.project.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.customerId).toBe(globex.id);
  });

  it("keeps the description it was given", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({
        name: "Described",
        customerId: acme.id,
        description: "## Scope\n\nEverything on the third floor.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.description).toContain("third floor");
  });

  it("has no cap — a customer may run as many as it likes", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);
    for (let i = 0; i < 6; i++) {
      await request(app)
        .post(`${API}/projects`)
        .set(bearer(sam))
        .send({ name: `Bulk ${i}`, customerId: acme.id })
        .expect(201);
    }
    expect(
      await prisma.project.count({ where: { customerId: acme.id, deletedAt: null } }),
    ).toBeGreaterThanOrEqual(6);
  });
});

describe("a project name is unique per customer, not globally", () => {
  it("refuses a name that customer already uses, and says so readably", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);

    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Acme Migration", customerId: acme.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROJECT_NAME_TAKEN");
    // Names the project, not a constraint. "customerId and name already exists"
    // is what the raw unique violation said, and is not a sentence anybody can
    // act on.
    expect(res.body.error.message).toContain("Acme Migration");
    expect(res.body.error.message).not.toMatch(/constraint|unique|customerId/i);
  });

  it("refuses one that differs only in case", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);
    // The unique index is case-SENSITIVE, so the database would accept this.
    // The service refuses it anyway: two names nobody can tell apart in a picker
    // are the same name as far as a person is concerned.
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "acme migration", customerId: acme.id });
    expect(res.status).toBe(409);
  });

  it("allows the same name under a different customer", async () => {
    const { globex } = await customers();
    const sam = await login(SUPER_ADMIN);

    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Acme Migration", customerId: globex.id });

    // Two companies may each run a "Migration" — which is the whole reason the
    // index is on (customer_id, name) rather than on the name alone.
    expect(res.status).toBe(201);
    expect(res.body.data.customerId).toBe(globex.id);
  });

  it("frees the name again once a project is archived", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);

    const first = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Seasonal", customerId: acme.id })
      .expect(201);

    await request(app)
      .delete(`${API}/projects/${first.body.data.id}`)
      .set(bearer(sam))
      .expect(204);

    // The unique index is partial on `deleted_at IS NULL`, so the name is free.
    // A check that counted archived rows would refuse what the database allows.
    await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Seasonal", customerId: acme.id })
      .expect(201);
  });

  it("lets a project keep its own name when something else is edited", async () => {
    const { acme } = await customers();
    const sam = await login(SUPER_ADMIN);
    const created = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Unchanged", customerId: acme.id })
      .expect(201);

    // A rename check that compared against every live row including this one
    // would refuse a project against itself.
    await request(app)
      .patch(`${API}/projects/${created.body.data.id}`)
      .set(bearer(sam))
      .send({ name: "Unchanged", description: "Now it has one." })
      .expect(200);
  });
});

describe("archiving a project", () => {
  /** A project with nobody routing through it, so the ticket guard is reachable. */
  async function emptyProject(token: string, name: string): Promise<number> {
    const { acme } = await customers();
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(token))
      .send({ name, customerId: acme.id })
      .expect(201);
    return res.body.data.id as number;
  }

  it("goes through when nothing is filed under it", async () => {
    const sam = await login(SUPER_ADMIN);
    const id = await emptyProject(sam, "Retire Me");
    await request(app).delete(`${API}/projects/${id}`).set(bearer(sam)).expect(204);

    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    // Soft, not gone: the id is on audit rows and on any ticket that used it.
    expect(row.deletedAt).not.toBeNull();
  });

  it("is refused while live work is filed under it, and counts it", async () => {
    const sam = await login(SUPER_ADMIN);
    const id = await emptyProject(sam, "Busy Project");

    const dana = await login(AGENT);
    const category = await prisma.category.findFirstOrThrow({
      where: { customer: { name: "Acme Corp" }, code: "NETWORK" },
    });
    await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "Filed under the project",
        description: "Raised by the project-crud suite.",
        categoryId: category.id,
        priority: "low",
        projectId: id,
      })
      .expect(201);

    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(sam));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROJECT_HAS_OPEN_TICKETS");
    expect(res.body.error.details).toEqual({ count: 1 });
  });

  it("counts open tickets only, so a long history does not pin a project open", async () => {
    const sam = await login(SUPER_ADMIN);
    const id = await emptyProject(sam, "Finished Project");

    const dana = await login(AGENT);
    const category = await prisma.category.findFirstOrThrow({
      where: { customer: { name: "Acme Corp" }, code: "NETWORK" },
    });
    const ticket = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "Done and dusted",
        description: "Raised by the project-crud suite.",
        categoryId: category.id,
        priority: "low",
        projectId: id,
      })
      .expect(201);

    await prisma.ticket.update({
      where: { id: ticket.body.data.id },
      data: { status: "closed", closedAt: new Date() },
    });

    // Archiving strands nothing: the closed ticket keeps pointing at the project
    // and keeps rendering its name. Counting closed ones would mean a routing
    // project that ran for a year could never be retired.
    await request(app).delete(`${API}/projects/${id}`).set(bearer(sam)).expect(204);
  });

  it("leaves the name on the tickets that used it", async () => {
    const sam = await login(SUPER_ADMIN);
    const id = await emptyProject(sam, "Named Forever");

    const dana = await login(AGENT);
    const category = await prisma.category.findFirstOrThrow({
      where: { customer: { name: "Acme Corp" }, code: "NETWORK" },
    });
    const ticket = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "Remembers its project",
        description: "Raised by the project-crud suite.",
        categoryId: category.id,
        priority: "low",
        projectId: id,
      })
      .expect(201);
    await prisma.ticket.update({
      where: { id: ticket.body.data.id },
      data: { status: "closed", closedAt: new Date() },
    });
    await request(app).delete(`${API}/projects/${id}`).set(bearer(sam)).expect(204);

    const after = await request(app)
      .get(`${API}/tickets/${ticket.body.data.id}`)
      .set(bearer(dana))
      .expect(200);
    expect(after.body.data.project?.name).toBe("Named Forever");
  });

  it("drops the project out of the list every picker reads", async () => {
    const sam = await login(SUPER_ADMIN);
    const id = await emptyProject(sam, "Gone From Pickers");

    const before = await request(app).get(`${API}/projects`).set(bearer(sam)).expect(200);
    expect(before.body.data.map((p: { id: number }) => p.id)).toContain(id);

    await request(app).delete(`${API}/projects/${id}`).set(bearer(sam)).expect(204);

    // The create-ticket form's dropdown reads this list, so leaving here is
    // leaving the dropdown — `projectScopeWhere` folds `deletedAt: null` in for
    // every reader at once.
    const after = await request(app).get(`${API}/projects`).set(bearer(sam)).expect(200);
    expect(after.body.data.map((p: { id: number }) => p.id)).not.toContain(id);
  });
});

describe("who may do any of this", () => {
  it("refuses a requester creating a project, whatever the UI shows them", async () => {
    const { acme } = await customers();
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(await login(REQUESTER)))
      .send({ name: "Straight At The API", customerId: acme.id });

    expect(res.status).toBe(403);
    expect(
      await prisma.project.count({ where: { name: "Straight At The API" } }),
    ).toBe(0);
  });

  it("refuses an agent creating or archiving one", async () => {
    const { acme } = await customers();
    const dana = await login(AGENT);

    await request(app)
      .post(`${API}/projects`)
      .set(bearer(dana))
      .send({ name: "Agent Project", customerId: acme.id })
      .expect(403);

    const existing = await prisma.project.findFirstOrThrow({
      where: { customerId: acme.id, deletedAt: null },
    });
    await request(app)
      .delete(`${API}/projects/${existing.id}`)
      .set(bearer(dana))
      .expect(403);
  });

  it("lets an agent still READ the routing table", async () => {
    // The half that makes the refusals above defensible: an agent working cases
    // needs to see where their queue's work comes from, which is why the read
    // and the write are different grants.
    await request(app)
      .get(`${API}/projects`)
      .set(bearer(await login(AGENT)))
      .expect(200);
  });
});
