import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Work may only be handed to somebody who can see it.
 *
 * `mayReceiveAssignment` asked two questions — is this candidate the sort of
 * person who holds work, and may the ACTOR hand work to them — and never the
 * third: can the candidate see the work being handed over. For a customer-bound
 * actor the second answered the third by accident, because their reach is one
 * customer and the work they can touch is inside it. For a platform-wide actor
 * the second is vacuous, so nothing was asked at all.
 *
 * Measured before the fix, through the API: assigning an Acme ticket to a
 * Globex agent returned 200, the agent then got 404 opening it, and it was
 * absent from their own queue. Nothing leaked — `ticketScopeWhere` still hid it
 * — the ticket simply left every queue at once.
 *
 * Three routes share the check, so all three are pinned here.
 */

const app = createApp();
const API = "/api/v1";

const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer
const ACME_AGENT = "dana.reyes@acme.com"; // admin, Acme
const GLOBEX_AGENT = "owen.park@acme.com"; // admin, Globex (address is seed-shaped)

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function userId(email: string): Promise<number> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return u.id;
}

/** An open Acme ticket to move around. */
async function acmeTicket(): Promise<number> {
  const acme = await prisma.customer.findFirstOrThrow({
    where: { name: "Acme Corp" },
  });
  const t = await prisma.ticket.findFirstOrThrow({
    where: { customerId: acme.id, status: "new", deletedAt: null },
  });
  return t.id;
}

async function acmeProject(): Promise<number> {
  const acme = await prisma.customer.findFirstOrThrow({
    where: { name: "Acme Corp" },
  });
  const p = await prisma.project.findFirstOrThrow({
    where: { customerId: acme.id, deletedAt: null },
  });
  return p.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("one ticket", () => {
  it("refuses another customer's staff, even to platform staff", async () => {
    const id = await acmeTicket();
    const res = await request(app)
      .patch(`${API}/tickets/${id}/assignee`)
      .set(bearer(await login(PLATFORM)))
      .send({ assigneeId: await userId(GLOBEX_AGENT) });

    expect(res.status).toBe(403);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.assigneeId).not.toBe(await userId(GLOBEX_AGENT));
  });

  it("allows that customer's own staff", async () => {
    const id = await acmeTicket();
    const dana = await userId(ACME_AGENT);
    const res = await request(app)
      .patch(`${API}/tickets/${id}/assignee`)
      .set(bearer(await login(PLATFORM)))
      .send({ assigneeId: dana });

    expect(res.status).toBe(200);
  });

  it("allows platform staff, who can see every customer's work", async () => {
    // The other direction has to keep working: somebody with no tenant of their
    // own sees every ticket, so this is work somebody is really holding.
    const id = await acmeTicket();
    const res = await request(app)
      .patch(`${API}/tickets/${id}/assignee`)
      .set(bearer(await login(PLATFORM)))
      .send({ assigneeId: await userId(PLATFORM) });

    expect(res.status).toBe(200);
  });
});

describe("a whole queue", () => {
  it("refuses a handover to another customer's staff", async () => {
    const dana = await userId(ACME_AGENT);
    const platform = await login(PLATFORM);
    // Give Dana something to hand over.
    await request(app)
      .patch(`${API}/tickets/${await acmeTicket()}/assignee`)
      .set(bearer(platform))
      .send({ assigneeId: dana })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/reassign`)
      .set(bearer(platform))
      .send({ fromUserId: dana, toUserId: await userId(GLOBEX_AGENT) });

    expect(res.status).toBe(403);
    // Refused whole: Dana still holds her queue.
    const stillHers = await prisma.ticket.count({
      where: { assigneeId: dana, status: "new" },
    });
    expect(stillHers).toBeGreaterThan(0);
  });

  it("allows a handover inside the customer", async () => {
    const dana = await userId(ACME_AGENT);
    const platform = await login(PLATFORM);
    await request(app)
      .patch(`${API}/tickets/${await acmeTicket()}/assignee`)
      .set(bearer(platform))
      .send({ assigneeId: dana })
      .expect(200);

    const ana = await prisma.user.findFirstOrThrow({
      where: { role: "admin", customer: { name: "Acme Corp" }, id: { not: dana } },
    });
    const res = await request(app)
      .post(`${API}/tickets/reassign`)
      .set(bearer(platform))
      .send({ fromUserId: dana, toUserId: ana.id });

    expect(res.status).toBe(200);
  });
});

describe("a routing project's owner", () => {
  it("refuses another customer's staff", async () => {
    // The owner takes every ticket the project routes, and
    // `findRoutingForRequester` does no tenant check of its own — so this is
    // the same failure, arriving later and without anybody pressing a button.
    const res = await request(app)
      .patch(`${API}/projects/${await acmeProject()}`)
      .set(bearer(await login(PLATFORM)))
      .send({ ownerId: await userId(GLOBEX_AGENT) });

    expect(res.status).toBe(403);
  });

  it("allows that customer's own staff, and platform staff", async () => {
    const id = await acmeProject();
    const token = await login(PLATFORM);

    await request(app)
      .patch(`${API}/projects/${id}`)
      .set(bearer(token))
      .send({ ownerId: await userId(ACME_AGENT) })
      .expect(200);

    await request(app)
      .patch(`${API}/projects/${id}`)
      .set(bearer(token))
      .send({ backupOwnerId: await userId(PLATFORM) })
      .expect(200);
  });
});
