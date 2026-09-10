import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/modules/auth/auth.password";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import { prisma, resetDb } from "./db";

/**
 * The tenant boundary, probed from outside rather than reasoned about.
 *
 * Every case here sends a real HTTP request holding a real token and checks what
 * comes back — because that is the only thing an attacker can do, and because a
 * scope builder can be perfectly correct while a route forgets to call it. What
 * is under test is the API's answer, not any function's return value.
 *
 * Four questions, which the spec names as the ones that matter:
 *   - can one customer reach another's rows?
 *   - can a role do what it may not?
 *   - can an account nobody has approved see anything at all?
 *   - can a write pair one customer's project with another's category?
 */

const app = createApp();
const API = "/api/v1";

const ACME_AGENT = "dana.reyes@acme.com";
const ACME_REQUESTER = "t.alvarez@acme.com";
const GLOBEX_AGENT = "owen.park@acme.com";
const GLOBEX_REQUESTER = "priya.shah@acme.com";
const PLATFORM_ADMIN = "sam.rivera@acme.com";
const PASSWORD = "password123";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD });
  expect(res.status, `${email} could not sign in`).toBe(200);
  return res.body.data.accessToken as string;
}

/** A customer's own row for a subject — there is no shared one any more. */
async function categoryFor(customerName: string, code: string) {
  return prisma.category.findFirstOrThrow({
    where: { code, customer: { name: customerName } },
  });
}

async function projectFor(customerName: string) {
  return prisma.project.findFirstOrThrow({
    where: { customer: { name: customerName }, deletedAt: null },
  });
}

/** A ticket belonging to `customerName`, whoever raised it. */
async function ticketOf(customerName: string) {
  return prisma.ticket.findFirstOrThrow({
    where: { customer: { name: customerName }, deletedAt: null },
  });
}

let acme: { agent: string; requester: string };
let globex: { agent: string; requester: string };
let platform: string;

beforeAll(async () => {
  await resetDb();
  acme = { agent: await login(ACME_AGENT), requester: await login(ACME_REQUESTER) };
  globex = {
    agent: await login(GLOBEX_AGENT),
    requester: await login(GLOBEX_REQUESTER),
  };
  platform = await login(PLATFORM_ADMIN);
});

describe("one customer cannot reach another's rows", () => {
  it("hides a ticket from an agent of a different customer", async () => {
    const acmeTicket = await ticketOf("Acme Corp");
    const res = await request(app)
      .get(`${API}/tickets/${acmeTicket.id}`)
      .set(bearer(globex.agent));
    // 404, not 403: a row outside your scope does not exist as far as you are
    // concerned, and 403 would confirm the id is real.
    expect(res.status).toBe(404);
  });

  it("hides it from a requester of a different customer too", async () => {
    const acmeTicket = await ticketOf("Acme Corp");
    const res = await request(app)
      .get(`${API}/tickets/${acmeTicket.id}`)
      .set(bearer(globex.requester));
    expect(res.status).toBe(404);
  });

  it("shows a requester only their OWN tickets, not their colleagues'", async () => {
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });
    const res = await request(app)
      .get(`${API}/tickets?limit=100`)
      .set(bearer(acme.requester));
    expect(res.status).toBe(200);
    const rows = res.body.data as { id: number }[];
    expect(rows.length).toBeGreaterThan(0);

    const ids = rows.map((r) => r.id);
    const raisedByThemCount = await prisma.ticket.count({
      where: { id: { in: ids }, requesterId: requester.id },
    });
    // Every single row came back because THEY raised it — not because it is
    // their company's.
    expect(raisedByThemCount).toBe(ids.length);
  });

  it("keeps the ticket LIST inside the caller's customer", async () => {
    const res = await request(app)
      .get(`${API}/tickets?limit=100`)
      .set(bearer(globex.agent));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: number }[]).map((r) => r.id);
    const foreign = await prisma.ticket.count({
      where: { id: { in: ids }, customer: { name: { not: "Globex Inc" } } },
    });
    expect(foreign).toBe(0);
  });

  it("keeps the category picker inside the caller's customer", async () => {
    const res = await request(app)
      .get(`${API}/categories`)
      .set(bearer(globex.agent));
    expect(res.status).toBe(200);
    const rows = res.body.data as { id: number; customerId: number }[];
    expect(rows.length).toBeGreaterThan(0);

    const globexCustomer = await prisma.customer.findFirstOrThrow({
      where: { name: "Globex Inc" },
    });
    // Every row is theirs. Before categories had owners this list also carried
    // the shared ones, and "not mine" was a legitimate answer; it is not any more.
    expect(rows.every((r) => r.customerId === globexCustomer.id)).toBe(true);
  });

  it("lets a platform-wide super admin see across every customer", async () => {
    // The counterpart the isolation cases would otherwise not prove: reach is
    // scoped, not broken. If this fails the others might be passing because
    // nobody can see anything.
    const res = await request(app)
      .get(`${API}/tickets?limit=200`)
      .set(bearer(platform));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: number }[]).map((r) => r.id);
    const customers = await prisma.ticket.findMany({
      where: { id: { in: ids } },
      distinct: ["customerId"],
      select: { customerId: true },
    });
    expect(customers.length).toBeGreaterThan(1);
  });
});

describe("a role cannot do what it may not", () => {
  it("refuses a requester the user directory", async () => {
    const res = await request(app).get(`${API}/users`).set(bearer(acme.requester));
    expect(res.status).toBe(403);
  });

  it("refuses a requester the audit trail and the routing table", async () => {
    for (const path of ["/audit", "/projects"]) {
      const res = await request(app).get(`${API}${path}`).set(bearer(acme.requester));
      expect(res.status, `${path} was readable by a requester`).toBe(403);
    }
  });

  /**
   * Wider than the permission matrix this work was specified against, and
   * deliberately so — asked and answered rather than assumed.
   *
   * The matrix said an agent may not create a customer. The shipped rule allows
   * `admin` and above, with its own reasoning (customer-crud.integration.test.ts:
   * "safe because it confers none — an admin who creates a tenant cannot see into
   * it and cannot grant themselves the reach to"), and archiving one is still
   * refused to them. Raised as a conflict; the shipped rule was kept.
   *
   * So this is the intended behaviour, not a gap — and the second half of the
   * case is the part that must never regress, because it is what makes the first
   * half safe.
   */
  it("lets an agent create a customer, and grants them no reach into it", async () => {
    const res = await request(app)
      .post(`${API}/customers`)
      .set(bearer(acme.agent))
      .send({ name: "Agent Tenant Probe" });
    expect(res.status).toBe(201);

    // The half that makes it defensible, and the half that must not regress:
    // creating a tenant grants no reach into it.
    const created = res.body.data.id as number;
    const list = await request(app).get(`${API}/customers`).set(bearer(acme.agent));
    expect((list.body.data as { id: number }[]).some((c) => c.id === created)).toBe(false);

    await prisma.category.deleteMany({ where: { customerId: created } });
    await prisma.auditLog.deleteMany({ where: { entity: "customer", entityId: created } });
    await prisma.customer.delete({ where: { id: created } });
  });

  it("refuses an AGENT the right to create a project", async () => {
    const customer = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(acme.agent))
      .send({ name: "Agent Project", customerId: customer.id });
    expect(res.status).toBe(403);
  });

  it("hides other people's workload from an agent", async () => {
    const colleague = await prisma.user.findUniqueOrThrow({
      where: { email: "ana.m@acme.com" },
    });
    const res = await request(app)
      .get(`${API}/reports/workload/${colleague.id}`)
      .set(bearer(acme.agent));
    expect([403, 404]).toContain(res.status);
  });
});

describe("an account nobody has approved sees nothing", () => {
  it("is refused every authenticated route, holding a genuinely signed token", async () => {
    const pending = await prisma.user.create({
      data: {
        name: "Not Approved",
        email: "not-approved@example.com",
        role: "user",
        status: "pending",
        // Verified and inside a customer, so the ONLY thing standing between
        // this account and the data is its status. If the gate were missing,
        // nothing else here would stop it.
        emailVerifiedAt: new Date(),
        customerId: (
          await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } })
        ).id,
        passwordHash: await hashPassword(PASSWORD),
      },
    });

    // Signed by the real signer, because sign-in will not issue one — which is
    // itself the first line of the defence and is covered in the auth suite.
    const token = signAccessToken({
      id: pending.id,
      name: pending.name,
      email: pending.email,
      role: pending.role,
      status: pending.status,
      teamId: null,
      department: null,
      customerId: pending.customerId,
      customerIds: [],
    });

    for (const path of [
      "/tickets",
      "/categories",
      "/customers",
      "/projects",
      "/dashboard/summary",
      "/kb",
      "/auth/me",
    ]) {
      const res = await request(app).get(`${API}${path}`).set(bearer(token));
      expect(res.status, `${path} answered a pending account with ${res.status}`).toBe(403);
    }
  });

  it("cannot raise a ticket either", async () => {
    const pending = await prisma.user.findFirstOrThrow({
      where: { email: "not-approved@example.com" },
    });
    const token = signAccessToken({
      id: pending.id,
      name: pending.name,
      email: pending.email,
      role: pending.role,
      status: pending.status,
      teamId: null,
      department: null,
      customerId: pending.customerId,
      customerIds: [],
    });
    const category = await categoryFor("Acme Corp", "NETWORK");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send({
        subject: "Should never exist",
        description: "Raised by an unapproved account",
        categoryId: category.id,
        priority: "low",
      });
    expect(res.status).toBe(403);
    expect(
      await prisma.ticket.count({ where: { subject: "Should never exist" } }),
    ).toBe(0);
  });
});

describe("a ticket cannot mix two customers", () => {
  it("refuses customer A's project alongside customer B's category", async () => {
    // The exact case the spec names. Both ids are real and both exist; what is
    // wrong is that they name different tenants, and the requester belongs to
    // only one of them.
    const acmeProject = await projectFor("Acme Corp");
    const globexCategory = await categoryFor("Globex Inc", "NETWORK");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(acme.requester))
      .send({
        subject: "Cross-tenant mix",
        description: "Acme project, Globex category",
        categoryId: globexCategory.id,
        projectId: acmeProject.id,
        priority: "low",
      });

    expect(res.status).toBe(400);
    expect(await prisma.ticket.count({ where: { subject: "Cross-tenant mix" } })).toBe(0);
  });

  it("refuses another customer's category on its own", async () => {
    const globexCategory = await categoryFor("Globex Inc", "NETWORK");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(acme.requester))
      .send({
        subject: "Foreign category only",
        description: "Globex category, no project",
        categoryId: globexCategory.id,
        priority: "low",
      });
    expect(res.status).toBe(400);
    // "Unknown", not "belongs to another customer" — the message must not
    // confirm that an id the caller may not see is real.
    expect(res.body.error.message).toMatch(/unknown category/i);
  });

  it("refuses another customer's project on its own", async () => {
    const globexProject = await projectFor("Globex Inc");
    const acmeCategory = await categoryFor("Acme Corp", "NETWORK");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(acme.requester))
      .send({
        subject: "Foreign project only",
        description: "Globex project, Acme category",
        categoryId: acmeCategory.id,
        projectId: globexProject.id,
        priority: "low",
      });
    expect(res.status).toBe(400);
    expect(
      await prisma.ticket.count({ where: { subject: "Foreign project only" } }),
    ).toBe(0);
  });

  it("accepts the matching pair, so the refusals above mean something", async () => {
    const acmeProject = await projectFor("Acme Corp");
    const acmeCategory = await categoryFor("Acme Corp", "NETWORK");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(acme.requester))
      .send({
        subject: "Matching pair",
        description: "Acme project, Acme category",
        categoryId: acmeCategory.id,
        projectId: acmeProject.id,
        priority: "low",
      });
    expect(res.status).toBe(201);
  });

  it("cannot be written past the service either — the database refuses it", async () => {
    // Straight at Prisma, bypassing every check the API makes. This is what
    // makes the rule a guarantee rather than a convention: a future code path
    // that forgets the service check still cannot produce the row.
    const acmeCustomer = await prisma.customer.findFirstOrThrow({
      where: { name: "Acme Corp" },
    });
    const globexCategory = await categoryFor("Globex Inc", "NETWORK");
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });

    await expect(
      prisma.ticket.create({
        data: {
          subject: "Straight past the service",
          description: "Written directly with a foreign category",
          requesterId: requester.id,
          categoryId: globexCategory.id,
          customerId: acmeCustomer.id,
          priority: "low",
        },
      }),
    ).rejects.toThrow();
  });
});
