import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb, tenantSuperAdmin } from "./db";

/**
 * Which routing project a user may be put into.
 *
 * `users.project_id` is not a label — it is what `findRoutingForRequester`
 * reads to decide who that person's next ticket lands on, and that function has
 * no customer check of its own. So the boundary has to hold here.
 *
 * The check used to ask about the CALLER's reach, which is the same question by
 * accident for a customer-bound admin — they can only see one customer's
 * projects and only edit its people — and no question at all for platform
 * staff, who reach everything. So it passed for anything a platform super admin
 * sent, and the screen offered the same set on the same assumption.
 *
 * What it costs is not a leak: the ticket keeps the requester's `customerId`,
 * so `ticketScopeWhere` still hides it from the foreign assignee. It is worse
 * in a quieter way — the ticket is assigned to somebody who cannot see it, and
 * so leaves every queue at once.
 */

const app = createApp();
const API = "/api/v1";
const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer → platform-wide

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A live project belonging to the named customer. */
async function projectOf(customerName: string): Promise<number> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: customerName },
  });
  const project = await prisma.project.findFirstOrThrow({
    where: { customerId: customer.id, deletedAt: null },
  });
  return project.id;
}

/** A requester belonging to the named customer. */
async function requesterOf(customerName: string): Promise<number> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: customerName },
  });
  const user = await prisma.user.findFirstOrThrow({
    where: { customerId: customer.id, role: "user" },
  });
  return user.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("a project must belong to the user's own customer", () => {
  it("attaches an Acme user to an Acme project", async () => {
    const acmeUser = await requesterOf("Acme Corp");
    const acmeProject = await projectOf("Acme Corp");

    const res = await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(await login(PLATFORM)))
      .send({ projectId: acmeProject });

    expect(res.status).toBe(200);
    expect(res.body.data.project.id).toBe(acmeProject);
  });

  it("refuses an Acme user a Globex project, even to platform staff", async () => {
    // The case the old check let through: the caller reaches every customer, so
    // asking about the CALLER answered yes.
    const acmeUser = await requesterOf("Acme Corp");
    const globexProject = await projectOf("Globex Inc");

    const res = await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(await login(PLATFORM)))
      .send({ projectId: globexProject });

    expect(res.status).toBe(400);
    // And nothing moved.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: acmeUser },
      select: { projectId: true },
    });
    expect(after.projectId).toBeNull();
  });

  it("refuses a customer's own super admin the same move", async () => {
    // Already refused before this change, by the caller's own reach. Pinned so
    // that tightening the rule for platform staff cannot loosen it for anybody
    // else on the way past.
    const acme = await tenantSuperAdmin("Acme Corp");
    const acmeUser = await requesterOf("Acme Corp");
    const globexProject = await projectOf("Globex Inc");

    const res = await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(await login(acme.email)))
      .send({ projectId: globexProject });

    expect(res.status).toBe(400);
  });

  it("refuses platform staff a project of their own, having no customer", async () => {
    // A project belongs to exactly one customer; platform staff belong to none,
    // so there is no project that could be theirs.
    const sam = await prisma.user.findFirstOrThrow({
      where: { email: PLATFORM },
    });
    expect(sam.customerId).toBeNull();

    const res = await request(app)
      .patch(`${API}/users/${sam.id}`)
      .set(bearer(await login(PLATFORM)))
      .send({ projectId: await projectOf("Acme Corp") });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/belong to no customer/i);
  });

  it("still lets anyone be taken out of a project", async () => {
    // Null is not a project and must not be dragged into the tenant check —
    // removing somebody has to keep working whatever their customer is.
    const acmeUser = await requesterOf("Acme Corp");
    const token = await login(PLATFORM);
    await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(token))
      .send({ projectId: await projectOf("Acme Corp") })
      .expect(200);

    const res = await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(token))
      .send({ projectId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.project).toBeNull();
  });

  it("refuses an archived project of the right customer", async () => {
    // The soft-delete clause rides on `projectScopeWhere`, which stays in the
    // check beside the tenant match rather than being replaced by it.
    const acmeUser = await requesterOf("Acme Corp");
    const acmeProject = await projectOf("Acme Corp");
    await prisma.project.update({
      where: { id: acmeProject },
      data: { deletedAt: new Date() },
    });

    const res = await request(app)
      .patch(`${API}/users/${acmeUser}`)
      .set(bearer(await login(PLATFORM)))
      .send({ projectId: acmeProject });

    expect(res.status).toBe(400);
  });
});
