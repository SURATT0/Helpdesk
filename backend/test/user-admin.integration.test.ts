import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/modules/auth/auth.password";
import { mailSender } from "../src/modules/integrations/email/mail-sender";
import { prisma, resetDb } from "./db";

/**
 * The approval queue and the directory behind it.
 *
 * The queue is not a collection of its own — it is the user directory filtered
 * to `status=pending`, which is deliberate and is a thing worth testing: one
 * list means one tenant filter, and a second endpoint would be a second place
 * for that filter to be got wrong.
 */

const app = createApp();
const API = "/api/v1";

const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer → platform-wide
const ACME_SUPER = "morgan.lee@acme.com"; // super_admin INSIDE Acme
const ACME_AGENT = "dana.reyes@acme.com"; // admin
const ACME_REQUESTER = "marcus.chen@acme.com"; // user
const PASSWORD = "password123";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD });
  expect(res.status, `${email} could not sign in`).toBe(200);
  return res.body.data.accessToken as string;
}

/** Somebody who has registered and confirmed, waiting on a decision. */
async function pendingApplicant(email = "applicant@example.com") {
  return prisma.user.create({
    data: {
      name: "Ada Applicant",
      email,
      role: "user",
      status: "pending",
      emailVerifiedAt: new Date(),
      // No customer — nobody has decided which one yet. This is what makes the
      // row invisible to every customer-bound principal.
      customerId: null,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

async function acmeId(): Promise<number> {
  const c = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  return c.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("the queue is the directory, filtered", () => {
  it("returns pending applicants to a platform super admin", async () => {
    const applicant = await pendingApplicant();
    const res = await request(app)
      .get(`${API}/users?status=pending`)
      .set(bearer(await login(PLATFORM)));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: number; status: string }[]);
    expect(ids.map((u) => u.id)).toContain(applicant.id);
    // Nothing but pending rows came back — the filter is a filter, not a hint.
    expect(ids.every((u) => u.status === "pending")).toBe(true);
  });

  it("hides them from a customer's own super admin, who has no tenant to put them in", async () => {
    const applicant = await pendingApplicant();
    const res = await request(app)
      .get(`${API}/users?status=pending`)
      .set(bearer(await login(ACME_SUPER)));
    expect(res.status).toBe(200);
    // Not a special case in the queue — it falls out of the directory's scope.
    // An applicant belongs to no customer, and a customer-bound principal sees
    // members of the customers they reach.
    expect((res.body.data as { id: number }[]).map((u) => u.id)).not.toContain(
      applicant.id,
    );
  });

  it("searches name and email together, and filters by role and customer", async () => {
    const platform = await login(PLATFORM);
    const byName = await request(app)
      .get(`${API}/users?q=marcus`)
      .set(bearer(platform));
    const byEmail = await request(app)
      .get(`${API}/users?q=marcus.chen@`)
      .set(bearer(platform));
    expect(byName.body.data).toHaveLength(1);
    expect(byEmail.body.data[0].id).toBe(byName.body.data[0].id);

    const admins = await request(app)
      .get(`${API}/users?role=admin`)
      .set(bearer(platform));
    expect((admins.body.data as { role: string }[]).every((u) => u.role === "admin")).toBe(true);

    const acme = await acmeId();
    const ofAcme = await request(app)
      .get(`${API}/users?customerId=${acme}`)
      .set(bearer(platform));
    expect(
      (ofAcme.body.data as { customer: { id: number } | null }[]).every(
        (u) => u.customer?.id === acme,
      ),
    ).toBe(true);
  });

  it("does not let a customerId filter reach a tenant outside the caller's reach", async () => {
    // The filter narrows the SCOPE; it never replaces it. Owen is Globex's, so
    // asking for Acme must answer with nothing rather than with Acme's staff.
    const globex = await login("owen.park@acme.com");
    const res = await request(app)
      .get(`${API}/users?customerId=${await acmeId()}`)
      .set(bearer(globex));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("approving a registration", () => {
  it("gives the account a tenant, a role, and the right to sign in", async () => {
    const sent: string[] = [];
    const spy = vi
      .spyOn(mailSender, "send")
      .mockImplementation(async (mail) => {
        sent.push(mail.subject);
        return { transport: "test" };
      });

    const applicant = await pendingApplicant();
    const acme = await acmeId();
    const res = await request(app)
      .post(`${API}/users/${applicant.id}/approve`)
      .set(bearer(await login(PLATFORM)))
      .send({ customerId: acme, role: "user" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "active",
      customer: { id: acme },
      role: "user",
    });

    // The whole point: they can now sign in, and nothing else had to change.
    const signIn = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: applicant.email, password: PASSWORD });
    expect(signIn.status).toBe(200);

    expect(sent.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("writes an audit row naming the tenant and role chosen", async () => {
    const applicant = await pendingApplicant();
    const acme = await acmeId();
    await request(app)
      .post(`${API}/users/${applicant.id}/approve`)
      .set(bearer(await login(PLATFORM)))
      .send({ customerId: acme, role: "admin" });

    const rows = await prisma.auditLog.findMany({
      where: { action: "user.approve", entityId: applicant.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ customerId: acme, role: "admin" });
  });

  it("refuses a second decision on the same row, so two admins cannot race", async () => {
    const applicant = await pendingApplicant();
    const acme = await acmeId();
    const platform = await login(PLATFORM);
    const approve = () =>
      request(app)
        .post(`${API}/users/${applicant.id}/approve`)
        .set(bearer(platform))
        .send({ customerId: acme, role: "user" });

    expect((await approve()).status).toBe(200);
    const second = await approve();
    expect(second.status).toBe(400);
    expect(second.body.error.message).toMatch(/already been decided/i);
  });

  it("refuses a customer that does not exist rather than writing into nothing", async () => {
    const applicant = await pendingApplicant();
    const res = await request(app)
      .post(`${API}/users/${applicant.id}/approve`)
      .set(bearer(await login(PLATFORM)))
      .send({ customerId: 999_999, role: "user" });
    expect(res.status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(after.status).toBe("pending");
  });

  it("insists on both a customer and a role", async () => {
    const applicant = await pendingApplicant();
    const platform = await login(PLATFORM);
    // Neither may be defaulted: approving decides which company somebody belongs
    // to and what they may do, and a default would make the most consequential
    // click in the product the one nobody had to think about.
    for (const body of [{ role: "user" }, { customerId: await acmeId() }]) {
      const res = await request(app)
        .post(`${API}/users/${applicant.id}/approve`)
        .set(bearer(platform))
        .send(body);
      expect(res.status, `${JSON.stringify(body)} was accepted`).toBe(400);
    }
  });

  it("is refused to everyone below a platform super admin", async () => {
    const applicant = await pendingApplicant();
    const acme = await acmeId();
    for (const who of [ACME_SUPER, ACME_AGENT, ACME_REQUESTER]) {
      const res = await request(app)
        .post(`${API}/users/${applicant.id}/approve`)
        .set(bearer(await login(who)))
        .send({ customerId: acme, role: "user" });
      expect([403, 404]).toContain(res.status);
    }
    const after = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(after.status).toBe("pending");
  });
});

describe("rejecting a registration", () => {
  it("marks it rejected and keeps the row as evidence", async () => {
    const applicant = await pendingApplicant();
    const res = await request(app)
      .post(`${API}/users/${applicant.id}/reject`)
      .set(bearer(await login(PLATFORM)))
      .send({ reason: "Not a customer of ours" });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    // Rejected, not deleted and not `isActive: false` — the row records that
    // somebody applied and a person said no, and they never arrived to leave.
    expect(after.status).toBe("rejected");
    expect(after.isActive).toBe(true);

    const rows = await prisma.auditLog.findMany({
      where: { action: "user.reject", entityId: applicant.id },
    });
    expect(rows[0].meta).toMatchObject({ reason: "Not a customer of ours" });
  });

  it("still refuses the sign-in, with its own message", async () => {
    const applicant = await pendingApplicant();
    await request(app)
      .post(`${API}/users/${applicant.id}/reject`)
      .set(bearer(await login(PLATFORM)))
      .send({});

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: applicant.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/not approved/i);
  });
});

describe("suspending an account", () => {
  it("stops the sign-in and can be lifted again", async () => {
    const platform = await login(PLATFORM);
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });

    const suspend = await request(app)
      .patch(`${API}/users/${target.id}`)
      .set(bearer(platform))
      .send({ status: "suspended" });
    expect(suspend.status).toBe(200);

    const refused = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ACME_REQUESTER, password: PASSWORD });
    expect(refused.status).toBe(401);
    expect(refused.body.error.message).toMatch(/suspended/i);

    await request(app)
      .patch(`${API}/users/${target.id}`)
      .set(bearer(platform))
      .send({ status: "active" })
      .expect(200);
    expect(
      (await request(app).post(`${API}/auth/login`).send({ email: ACME_REQUESTER, password: PASSWORD })).status,
    ).toBe(200);
  });

  it("cannot push an account into the approval states through the patch", async () => {
    const platform = await login(PLATFORM);
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });
    // `pending` and `rejected` belong to the queue. Reachable here, an active
    // account could be pushed back into a queue it has already been through, or
    // marked rejected without anyone making that decision.
    for (const status of ["pending", "rejected"]) {
      const res = await request(app)
        .patch(`${API}/users/${target.id}`)
        .set(bearer(platform))
        .send({ status });
      expect(res.status, `${status} was accepted by the patch`).toBe(400);
    }
  });

  it("ends a live session at the next refresh, not just at the next sign-in", async () => {
    // A suspension has to bite a tab that is already open. The access token
    // stays valid for its 15 minutes, so `refresh` is where the row is re-read.
    const victim = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ACME_REQUESTER, password: PASSWORD });
    const cookie = victim.headers["set-cookie"];

    const target = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });
    await request(app)
      .patch(`${API}/users/${target.id}`)
      .set(bearer(await login(PLATFORM)))
      .send({ status: "suspended" })
      .expect(200);

    const after = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", cookie);
    expect(after.status).toBe(401);
  });
});

describe("a user who has raised a ticket cannot be deleted", () => {
  it("has no delete endpoint at all, and the database refuses it too", async () => {
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: ACME_REQUESTER },
    });
    const res = await request(app)
      .delete(`${API}/users/${requester.id}`)
      .set(bearer(await login(PLATFORM)));
    // 404/405 — the route does not exist, deliberately: deactivation is how
    // someone who has left is retired.
    expect([404, 405]).toContain(res.status);

    // And the schema is what makes it a guarantee rather than a missing route:
    // `Ticket.requesterId` is RESTRICT.
    await expect(
      prisma.user.delete({ where: { id: requester.id } }),
    ).rejects.toThrow();
  });
});
