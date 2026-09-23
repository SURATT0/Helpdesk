import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { submitIntake } from "../src/modules/publicIntake/intake.service";
import { prisma, resetDb } from "./db";

/**
 * RBAC/visibility scenarios the design doc doesn't cover, because they are
 * Deskly's own rules, not the public form's — requested explicitly on top of
 * the design doc's §13 test plan. Two of the eight originally-listed
 * scenarios don't literally apply given how the earlier blockers were
 * resolved and were adapted; see the conversation for why:
 *
 *   - "customerId = null" cannot occur: an unmatched submission gets the
 *     SYSTEM TENANT's real id (option A from the original blocker), never
 *     null. Adapted to: does reach to that real tenant behave normally?
 *   - "no category yet" cannot occur either: every intake ticket gets a real
 *     category (the resolved tenant's "Other") at creation. Adapted to: does
 *     an intake ticket's detail view render cleanly with that category?
 *
 * Ticket-numbering-under-concurrency is already covered in
 * public-intake-persistence.integration.test.ts and is not repeated here.
 */

const app = createApp();
const API = "/api/v1";
const PASSWORD = "password123";

const VALID: Record<string, unknown> = {
  name: "สุรัตน์ ใจดี",
  companyName: "บริษัท ตัวอย่าง จำกัด",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "อยากปรึกษาเรื่องวางระบบ RPA ให้ทีมงานติดต่อกลับด้วยครับ",
  consent: true,
  source: "web-intake-form",
  submittedAt: "2026-09-21T09:30:00.000Z",
};
const META = { ip: "203.0.113.1", userAgent: "vitest" };

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return res.body.data.accessToken as string;
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const userId = async (email: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

async function grantReach(platformToken: string, targetUserId: number, customerIds: number[]) {
  const res = await request(app)
    .put(`${API}/users/${targetUserId}/reach`)
    .set(bearer(platformToken))
    .send({ customerIds });
  expect(res.status, "grant reach").toBe(200);
}

async function visibleTicketIds(token: string): Promise<number[]> {
  const res = await request(app).get(`${API}/tickets?pageSize=100`).set(bearer(token));
  expect(res.status).toBe(200);
  return (res.body.data as { id: number }[]).map((t) => t.id);
}

async function submitUnmatched(email: string) {
  const outcome = await submitIntake(
    { ...VALID, businessEmail: email },
    [],
    META,
  );
  expect(outcome.kind).toBe("created");
  if (outcome.kind !== "created") throw new Error("expected created");
  return outcome;
}

beforeEach(async () => {
  await resetDb();
});

describe("an unmatched (system-tenant) intake ticket — adapted from 'customerId = null'", () => {
  it("is invisible to an agent with NO reach to the system tenant", async () => {
    const { ticketId } = await submitUnmatched("nobody@no-such-domain-example.test");
    const dana = await login("dana.reyes@acme.com"); // admin, Acme only
    expect(await visibleTicketIds(dana)).not.toContain(ticketId);
  });

  it("becomes visible to that same agent once granted reach to the system tenant", async () => {
    const { ticketId } = await submitUnmatched("nobody2@no-such-domain-example.test");
    const systemTenant = await prisma.customer.findFirstOrThrow({
      where: { isSystemTenant: true },
    });
    const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
    const platform = await login("sam.rivera@acme.com"); // platform-wide super_admin
    await grantReach(platform, await userId("dana.reyes@acme.com"), [
      acme.id,
      systemTenant.id,
    ]);

    const dana = await login("dana.reyes@acme.com");
    expect(await visibleTicketIds(dana)).toContain(ticketId);
  });

  it("is never visible to a plain user-role person at an unrelated customer, granted or not", async () => {
    const { ticketId } = await submitUnmatched("nobody3@no-such-domain-example.test");
    // Priya is role `user` at Globex — nothing to grant her; ticketScopeWhere's
    // `user` branch is `{requesterId: user.id}`, which reach cannot widen.
    // (Every seeded account uses an @acme.com address regardless of tenant —
    // see emailFor() in prisma/seed-fn.ts — so this is not a typo.)
    const priya = await login("priya.shah@acme.com");
    expect(await visibleTicketIds(priya)).not.toContain(ticketId);
  });
});

describe("a matched submission's real requester — the fix for test #3's original gap", () => {
  it("sees their own intake ticket once logged in, exactly like any ticket they raised themselves", async () => {
    const acme = await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });
    // Reuse an EXISTING seeded Acme user's address, so findOrCreateRequester
    // takes the reuse path and this test proves the account they can already
    // log into is the one the ticket attaches to.
    const marcus = await prisma.user.findFirstOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    await prisma.user.update({
      where: { id: marcus.id },
      data: { email: "marcus@acme.co.th" },
    });

    const outcome = await submitIntake(
      { ...VALID, businessEmail: "marcus@acme.co.th" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const token = await login("marcus@acme.co.th");
    expect(await visibleTicketIds(token)).toContain(outcome.ticketId);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: outcome.ticketId } });
    expect(ticket.requesterId).toBe(marcus.id);
    expect(ticket.customerId).toBe(acme.id);
  });
});

describe("authentication boundary — the new route is the ONLY exception", () => {
  it("accepts the public intake endpoint with no session at all", async () => {
    const res = await request(app)
      .post(`${API}/public/tickets`)
      .send({ ...VALID, businessEmail: "noauth@no-such-domain-example.test" });
    expect(res.status).toBe(201);
  });

  it("still refuses every other endpoint with no session — nothing else was widened", async () => {
    const endpoints: Array<[string, string]> = [
      ["get", "/tickets"],
      ["get", "/dashboard"],
      ["get", "/users"],
      ["get", "/customers"],
      ["get", "/reports"],
      ["get", "/auth/me"],
    ];
    for (const [method, path] of endpoints) {
      const res = await (request(app) as any)[method](`${API}${path}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});

describe("closing an intake ticket — the existing resolution rule is not bypassed", () => {
  it("still 400s a new→pending move with no resolution, for a ticket the form raised", async () => {
    const acme = await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "resolution-test@acme.co.th" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: outcome.ticketId } })).customerId).toBe(acme.id);

    const dana = await login("dana.reyes@acme.com"); // admin, Acme — reaches this ticket natively
    const withoutResolution = await request(app)
      .patch(`${API}/tickets/${outcome.ticketId}/status`)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(withoutResolution.status).toBe(400);
    expect(withoutResolution.body.error.code).toBe("RESOLUTION_REQUIRED");

    const withResolution = await request(app)
      .patch(`${API}/tickets/${outcome.ticketId}/status`)
      .set(bearer(dana))
      .send({ status: "pending", resolution: "Walked them through the RPA setup on a call." });
    expect(withResolution.status).toBe(200);
  });
});

describe("the detail view — adapted from 'no category yet', which cannot occur", () => {
  it("renders an intake ticket cleanly: real category, categoryOther, and channel all present", async () => {
    const acme = await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "detail-test@acme.co.th" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: outcome.ticketId } })).customerId).toBe(acme.id);

    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/tickets/${outcome.ticketId}`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    expect(res.body.data.category).toBeTruthy();
    expect(res.body.data.categoryOther).toContain("rpa-consult");
  });
});
