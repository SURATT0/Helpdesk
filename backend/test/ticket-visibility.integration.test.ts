import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Who sees whose tickets, and which conversations a ticket has.
 *
 * Both questions are answered by the same fact — the requester — so they are
 * tested together: a requester sees only the tickets they raised, staff see
 * everything inside their customer no matter who raised it, and a ticket staff
 * raised for themselves has no external side to chat with or mail.
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

/** Ids are seeded deterministically, but the category is looked up by name. */
async function networkCategoryId(): Promise<number> {
  const c = await prisma.category.findUniqueOrThrow({
    where: { name: "Network" },
  });
  return c.id;
}

async function raise(token: string, subject: string): Promise<number> {
  const res = await request(app)
    .post(`${API}/tickets`)
    .set(bearer(token))
    .send({
      subject,
      description: `${subject} — raised by the visibility suite`,
      categoryId: await networkCategoryId(),
      priority: "low",
    });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

/** A seeded ticket this requester raised, so the tests need no fixture of their own. */
async function seededTicketOf(email: string): Promise<number> {
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { requester: { email }, deletedAt: null },
    orderBy: { id: "asc" },
  });
  return ticket.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("ticket row scope", () => {
  it("shows a requester their own tickets and nothing else", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app).get(`${API}/tickets`).set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Every row, not just the first: a leak shows up as one foreign row among
    // the caller's own, which a spot check on `data[0]` would sail past.
    for (const ticket of res.body.data) {
      expect(ticket.requester).toBe("Marcus Chen");
    }

    const someoneElse = await seededTicketOf("t.alvarez@acme.com");
    const direct = await request(app)
      .get(`${API}/tickets/${someoneElse}`)
      .set(bearer(marcus));
    // 404 rather than 403: an out-of-scope ticket does not exist as far as this
    // caller is concerned, so the response cannot confirm the id is real either.
    expect(direct.status).toBe(404);
  });

  it("shows an admin the tickets of requesters and of other admins alike", async () => {
    const kai = await login("kai.t@acme.com");
    const raisedByAnAdmin = await raise(kai, "switch stack firmware audit");
    const raisedByARequester = await seededTicketOf("marcus.chen@acme.com");

    const dana = await login("dana.reyes@acme.com");
    const list = await request(app).get(`${API}/tickets`).set(bearer(dana));
    expect(list.status).toBe(200);
    const ids = list.body.data.map((t: { id: number }) => t.id);
    expect(ids).toContain(raisedByAnAdmin);
    expect(ids).toContain(raisedByARequester);

    // A third admin, to pin that this is the customer's whole desk seeing it and
    // not some relationship between these two accounts.
    const ana = await login("ana.m@acme.com");
    const direct = await request(app)
      .get(`${API}/tickets/${raisedByAnAdmin}`)
      .set(bearer(ana));
    expect(direct.status).toBe(200);
  });

  it("hides an admin's own ticket from requesters and from another customer", async () => {
    const kai = await login("kai.t@acme.com");
    const id = await raise(kai, "desk laptop imaging backlog");

    const marcus = await login("marcus.chen@acme.com");
    const asRequester = await request(app)
      .get(`${API}/tickets/${id}`)
      .set(bearer(marcus));
    expect(asRequester.status).toBe(404);

    // Owen administers Globex; the ticket belongs to Acme. Same role, no reach.
    const owen = await login("owen.park@acme.com");
    const acrossTenants = await request(app)
      .get(`${API}/tickets/${id}`)
      .set(bearer(owen));
    expect(acrossTenants.status).toBe(404);
  });
});

describe("a ticket the desk raised for itself", () => {
  it("reports the requester's role, which is what tells the two threads apart", async () => {
    const kai = await login("kai.t@acme.com");
    const own = await raise(kai, "spare SFP inventory");
    const forARequester = await seededTicketOf("marcus.chen@acme.com");

    const dana = await login("dana.reyes@acme.com");
    const staffRaised = await request(app)
      .get(`${API}/tickets/${own}`)
      .set(bearer(dana));
    expect(staffRaised.body.data.requesterRole).toBe("admin");

    const userRaised = await request(app)
      .get(`${API}/tickets/${forARequester}`)
      .set(bearer(dana));
    expect(userRaised.body.data.requesterRole).toBe("user");
  });

  it("stores a message on it as an internal note, even when asked for a public one", async () => {
    const kai = await login("kai.t@acme.com");
    const id = await raise(kai, "core switch config drift");

    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(dana))
      .send({ body: "Rolled the config back to last week's snapshot.", internal: false });

    expect(res.status).toBe(201);
    expect(res.body.data.internal).toBe(true);
  });

  it("leaves a public comment public when a requester raised the ticket", async () => {
    const id = await seededTicketOf("marcus.chen@acme.com");
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(dana))
      .send({ body: "Looking into it now.", internal: false });

    expect(res.status).toBe(201);
    expect(res.body.data.internal).toBe(false);
  });

  it("refuses an email reply, because there is nobody on the other end", async () => {
    const kai = await login("kai.t@acme.com");
    const id = await raise(kai, "wifi controller upgrade window");

    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/${id}/reply`)
      .set(bearer(dana))
      .send({ to: "kai.t@acme.com", body: "Scheduled for Friday." });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/internal note/);
    // Refused before anything was written: a reply that half-happened would
    // leave the message in the thread while the agent was told it failed.
    const comments = await prisma.comment.count({ where: { ticketId: id } });
    expect(comments).toBe(0);
  });

  it("still sends a reply on a requester's ticket", async () => {
    const id = await seededTicketOf("marcus.chen@acme.com");
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/${id}/reply`)
      .set(bearer(dana))
      .send({ to: "marcus.chen@acme.com", body: "Sending you a new profile." });

    expect(res.status).toBe(201);
    expect(res.body.data.mail.to).toBe("marcus.chen@acme.com");
  });
});
