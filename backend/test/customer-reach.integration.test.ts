import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

const app = createApp();
const API = "/api/v1";

// Seeded principals, chosen for what each one is rather than who:
const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer → platform-wide
const ACME_ADMIN = "dana.reyes@acme.com"; // admin, Acme — the one being granted
const ACME_SUPER = "morgan.lee@acme.com"; // super_admin WITH a customer
const GLOBEX_USER = "priya.shah@acme.com"; // role `user`, Globex
const PASSWORD = "password123";

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
const customerId = async (name: string) =>
  (await prisma.customer.findFirstOrThrow({ where: { name } })).id;

/** Ticket ids the caller's list returns, across every page the suite needs. */
async function visibleTicketIds(token: string): Promise<number[]> {
  const res = await request(app)
    .get(`${API}/tickets?pageSize=100`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return (res.body.data as { id: number }[]).map((t) => t.id);
}

async function grant(
  token: string,
  targetId: number,
  customerIds: number[],
) {
  return request(app)
    .put(`${API}/users/${targetId}/reach`)
    .set(bearer(token))
    .send({ customerIds });
}

beforeEach(async () => {
  await resetDb();
});

/**
 * One member of staff, two client companies.
 *
 * The seed gives every account a single customer, which is what reach meant
 * before this table existed — so these start by pinning that unchanged
 * behaviour, then grant, and check the boundary moved exactly as far as the
 * grant says and no further.
 */
describe("an agent granted a second customer", () => {
  it("sees only their own customer before anything is granted", async () => {
    const dana = await login(ACME_ADMIN);
    const globexTickets = await prisma.ticket.findMany({
      where: { customerId: await customerId("Globex Inc") },
      select: { id: true },
    });
    expect(globexTickets.length).toBeGreaterThan(0);

    const visible = await visibleTicketIds(dana);
    for (const t of globexTickets) expect(visible).not.toContain(t.id);
  });

  it("sees the other customer's tickets after signing in again", async () => {
    const globex = await customerId("Globex Inc");
    const platform = await login(PLATFORM);
    const res = await grant(platform, await userId(ACME_ADMIN), [globex]);
    expect(res.status).toBe(200);
    expect(res.body.data.reach).toEqual([{ id: globex, name: "Globex Inc" }]);

    const dana = await login(ACME_ADMIN);
    const visible = await visibleTicketIds(dana);
    const globexTickets = await prisma.ticket.findMany({
      where: { customerId: globex, deletedAt: null },
      select: { id: true },
    });
    for (const t of globexTickets) expect(visible).toContain(t.id);
    // And has not lost their own.
    const acmeTicket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: await customerId("Acme Corp"), deletedAt: null },
      select: { id: true },
    });
    expect(visible).toContain(acmeTicket.id);
  });

  it("does not widen a token that was already issued", async () => {
    // Reach is resolved when the access token is signed, so a grant bites at
    // the next sign-in or refresh — the same 15-minute lag the role has always
    // had, and the reason this is worth stating rather than discovering.
    const danaBefore = await login(ACME_ADMIN);
    const globex = await customerId("Globex Inc");
    const platform = await login(PLATFORM);
    await grant(platform, await userId(ACME_ADMIN), [globex]);

    const globexTicket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: globex, deletedAt: null },
      select: { id: true },
    });
    expect(await visibleTicketIds(danaBefore)).not.toContain(globexTicket.id);
  });

  it("loses the reach again when the grant is revoked", async () => {
    const globex = await customerId("Globex Inc");
    const platform = await login(PLATFORM);
    const dana = await userId(ACME_ADMIN);
    await grant(platform, dana, [globex]);
    expect(await visibleTicketIds(await login(ACME_ADMIN))).toContain(
      (
        await prisma.ticket.findFirstOrThrow({
          where: { customerId: globex, deletedAt: null },
          select: { id: true },
        })
      ).id,
    );

    // An empty set is the revoke — the same endpoint, no second verb.
    const revoked = await grant(platform, dana, []);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.reach).toEqual([]);

    const globexTicket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: globex, deletedAt: null },
      select: { id: true },
    });
    expect(await visibleTicketIds(await login(ACME_ADMIN))).not.toContain(
      globexTicket.id,
    );
  });

  it("is not thereby a member of that customer's directory", async () => {
    // Reach is permission to see a tenant's work, not membership of it. If a
    // grant put someone in the directory they would turn up in the assignee
    // picker and the workload report as though they were part of that desk.
    const globex = await customerId("Globex Inc");
    const platform = await login(PLATFORM);
    await grant(platform, await userId(ACME_ADMIN), [globex]);

    const owen = await login("owen.park@acme.com"); // Globex admin
    const res = await request(app).get(`${API}/users`).set(bearer(owen));
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).not.toContain(ACME_ADMIN);
  });

  it("still is not platform-wide, so a customer made later stays out of reach", async () => {
    // The invariant the whole model rests on. Reaching every customer that
    // exists today is a list; being platform-wide is a different fact, and only
    // it follows the platform forward.
    const platform = await login(PLATFORM);
    const all = await prisma.customer.findMany({ select: { id: true } });
    await grant(
      platform,
      await userId(ACME_ADMIN),
      all.map((c) => c.id),
    );

    // `resetDb` truncates tickets and users but NOT customers — the seed upserts
    // those, and putting them in the wipe would renumber every tenant id the
    // rest of the suite relies on. So this one cleans up after itself. Safe
    // here and not in `afterEach`: the reset above has already taken the tickets
    // that referenced it, so nothing is left pointing at the row.
    const LATER = "Initech (opened later)";
    await prisma.customer.deleteMany({ where: { name: LATER } });
    const later = await prisma.customer.create({ data: { name: LATER } });
    const requester = await prisma.user.findFirstOrThrow({
      where: { role: "user" },
    });
    // The new tenant's OWN category, created here because this fixture makes the
    // customer with a bare `prisma.customer.create` — the starter set is written
    // by `customerRepository.create`, which this deliberately bypasses.
    //
    // An unfiltered `findFirstOrThrow()` used to work here and no longer can:
    // a ticket may only carry a category of its own customer, and the composite
    // foreign key refuses the insert rather than letting the row exist. Which is
    // the point — this test is ABOUT a tenant boundary, and it was quietly
    // reaching across one to build its own fixture.
    const category = await prisma.category.create({
      data: { name: "Network", code: "NETWORK", customerId: later.id },
    });
    const stranger = await prisma.ticket.create({
      data: {
        subject: "Raised in a customer created after the grant",
        description: "x",
        requesterId: requester.id,
        categoryId: category.id,
        customerId: later.id,
      },
    });

    const dana = await login(ACME_ADMIN);
    expect(await visibleTicketIds(dana)).not.toContain(stranger.id);
    // …while the genuinely platform-wide principal does see it.
    expect(await visibleTicketIds(await login(PLATFORM))).toContain(stranger.id);
  });
});

/**
 * Who may hand reach out. This is the endpoint that moves someone across the
 * tenant boundary, so every way of reaching it from below has its own case.
 */
describe("granting reach is platform-wide only", () => {
  it("refuses an admin, who may create a customer but not walk into one", async () => {
    const dana = await login(ACME_ADMIN);
    const res = await grant(dana, await userId("kai.t@acme.com"), [
      await customerId("Globex Inc"),
    ]);
    expect(res.status).toBe(403);
  });

  it("refuses a customer's own super admin", async () => {
    // Top role, but a tenant of their own — reach, not the role name, is what
    // decides this, exactly as it decides granting the super_admin role.
    const morgan = await login(ACME_SUPER);
    const res = await grant(morgan, await userId("kai.t@acme.com"), [
      await customerId("Globex Inc"),
    ]);
    expect(res.status).toBe(403);
  });

  it("refuses even a platform admin granting to themselves", async () => {
    const platform = await login(PLATFORM);
    const res = await grant(platform, await userId(PLATFORM), [
      await customerId("Globex Inc"),
    ]);
    expect(res.status).toBe(403);
  });

  it("refuses a grant to a requester, which would read as effective and do nothing", async () => {
    const platform = await login(PLATFORM);
    const res = await grant(platform, await userId(GLOBEX_USER), [
      await customerId("Acme Corp"),
    ]);
    expect(res.status).toBe(400);

    // And the claim behind that refusal: a `user` sees their own tickets
    // whatever reach says, so storing one would be a setting that lies.
    const globexUserId = await userId(GLOBEX_USER);
    await prisma.userCustomer.create({
      data: { userId: globexUserId, customerId: await customerId("Acme Corp") },
    });
    const priya = await login(GLOBEX_USER);
    const visible = await visibleTicketIds(priya);
    const theirs = await prisma.ticket.findMany({
      where: { requesterId: globexUserId, deletedAt: null },
      select: { id: true },
    });
    expect(visible.sort()).toEqual(theirs.map((t) => t.id).sort());
  });

  it("refuses a customer that does not exist, naming it", async () => {
    const platform = await login(PLATFORM);
    const res = await grant(platform, await userId(ACME_ADMIN), [999999]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("999999");
    expect(
      await prisma.userCustomer.count({
        where: { userId: await userId(ACME_ADMIN) },
      }),
    ).toBe(0);
  });

  it("records what the reach became, not how it got there", async () => {
    const globex = await customerId("Globex Inc");
    const platform = await login(PLATFORM);
    const dana = await userId(ACME_ADMIN);
    await grant(platform, dana, [globex]);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "user.reach_set", entityId: dana },
      orderBy: { id: "desc" },
    });
    expect(entry.userId).toBe(await userId(PLATFORM));
    expect(entry.meta).toEqual({ customerIds: [globex] });
  });
});
