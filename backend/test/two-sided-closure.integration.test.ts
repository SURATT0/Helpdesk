import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ticketService } from "../src/modules/tickets/ticket.service";
import { prisma, resetDb } from "./db";

/**
 * Closing a ticket takes two sides.
 *
 * The desk says the work is done by moving the ticket to `pending`; until now
 * only the desk could take it from there, so "closed" was one side's opinion —
 * the requester either agreed in silence or watched the 72h sweep close it over
 * their head. These endpoints are the other side of that, and what they must get
 * right is WHO may use them and FROM WHERE.
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

/** A ticket of Marcus's, moved to pending by the desk — the state under test. */
async function pendingTicketOfMarcus(): Promise<number> {
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { requester: { email: "marcus.chen@acme.com" }, deletedAt: null },
    orderBy: { id: "asc" },
  });
  const dana = await login("dana.reyes@acme.com");
  await request(app)
    .patch(`${API}/tickets/${ticket.id}/status`)
    .set(bearer(dana))
    .send({ status: "pending" })
    .expect(200);
  return ticket.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("the requester confirms a closure", () => {
  it("closes the ticket and records who agreed", async () => {
    const id = await pendingTicketOfMarcus();
    const marcus = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    expect(res.body.data.displayStatus).toBe("closed");
    expect(res.body.data.closedAt).not.toBeNull();

    // "pending → closed" alone cannot say whether a person agreed or a sweep
    // gave up waiting, so the agreement is recorded as its own audit action.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "ticket", entityId: id, action: "ticket.closure_confirmed" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.meta).toMatchObject({ via: "in_app" });

    // And it goes through the ordinary status write, so the trail is the same
    // one a desk-driven close leaves.
    const history = await prisma.ticketStatusHistory.findFirst({
      where: { ticketId: id, toStatus: "closed" },
    });
    expect(history).not.toBeNull();
  });

  it("tells the assignee, and does not notify the person who clicked", async () => {
    const id = await pendingTicketOfMarcus();
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    await prisma.notification.deleteMany({ where: { ticketId: id } });

    const token = await login("marcus.chen@acme.com");
    await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(token))
      .expect(200);

    const notes = await prisma.notification.findMany({ where: { ticketId: id } });
    expect(notes.map((n) => n.userId)).toContain(dana.id);
    expect(notes.map((n) => n.userId)).not.toContain(marcus.id);
  });
});

describe("the requester rejects a closure", () => {
  it("sends it back to the desk with the assignee kept", async () => {
    const id = await pendingTicketOfMarcus();
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    const marcus = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/reject`)
      .set(bearer(marcus))
      .send({ reason: "The VPN still drops every ten minutes." });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
    // Kept, so it lands back on the person who did the work rather than in the
    // unassigned queue — which is also why it reads as In Progress again.
    expect(res.body.data.assigneeId).toBe(before.assigneeId);
    expect(res.body.data.displayStatus).toBe(
      before.assigneeId == null ? "new" : "in_progress",
    );
  });

  it("puts the reason in the thread, publicly, from the requester", async () => {
    const id = await pendingTicketOfMarcus();
    const marcus = await login("marcus.chen@acme.com");
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });

    await request(app)
      .post(`${API}/tickets/${id}/closure/reject`)
      .set(bearer(marcus))
      .send({ reason: "Still broken on the third floor." })
      .expect(200);

    const comment = await prisma.comment.findFirst({
      where: { ticketId: id, authorId: me.id },
      orderBy: { id: "desc" },
    });
    expect(comment?.body).toBe("Still broken on the third floor.");
    // Public: it is a message to the person who did the work, not a note about
    // them. An internal note would be invisible to its own author here.
    expect(comment?.internal).toBe(false);
  });

  it("takes no reason at all — refusing is a complete answer", async () => {
    const id = await pendingTicketOfMarcus();
    const marcus = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/reject`)
      .set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
    expect(
      await prisma.auditLog.findFirst({
        where: { entityId: id, action: "ticket.closure_rejected" },
      }),
    ).not.toBeNull();
  });
});

describe("who may answer a closure", () => {
  it("refuses another requester with 403, not a quiet no-op", async () => {
    const id = await pendingTicketOfMarcus();
    const someoneElse = await login("t.alvarez@acme.com");

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(someoneElse));
    // 404 would be right for a ticket they cannot see; this one they cannot see
    // either, so the row scope answers first.
    expect(res.status).toBe(404);
  });

  it("refuses an admin who did not raise it — they have the status endpoint", async () => {
    const id = await pendingTicketOfMarcus();
    const dana = await login("dana.reyes@acme.com"); // the assignee, not the requester

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(dana));

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/person who raised/);

    // And the desk's own route still works for them, so nothing is taken away.
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "closed" })
      .expect(200);
  });

  it("lets an admin answer a ticket they raised themselves", async () => {
    // The internal-thread case: the desk raises work for itself, so the same
    // person is both sides. Being the requester is what grants this, not a role.
    const kai = await login("kai.t@acme.com");
    const category = await prisma.category.findFirstOrThrow();
    const created = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(kai))
      .send({
        subject: "Rebuild the imaging share index",
        description: "Housekeeping the desk raised for itself.",
        categoryId: category.id,
        priority: "low",
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as number;

    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(kai))
      .send({ status: "pending" })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(kai));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
  });
});

describe("when a closure can be answered", () => {
  it("refuses a ticket that is not waiting on anyone, and says what it is", async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: {
        requester: { email: "marcus.chen@acme.com" },
        status: "new",
        deletedAt: null,
      },
    });
    const marcus = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets/${ticket.id}/closure/confirm`)
      .set(bearer(marcus));

    expect(res.status).toBe(400);
    // The message names the state it is actually in, so the reader knows whether
    // to wait or to chase someone.
    expect(res.body.error.message).toMatch(/not waiting to be confirmed/);
  });

  it("cannot be answered twice", async () => {
    const id = await pendingTicketOfMarcus();
    const marcus = await login("marcus.chen@acme.com");
    await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(marcus))
      .expect(200);

    const again = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(marcus));
    expect(again.status).toBe(400);
  });

  it("still auto-closes when nobody answers, which is the fallback these actions sit on", async () => {
    const id = await pendingTicketOfMarcus();
    // Finished four days ago and never confirmed.
    await prisma.ticket.update({
      where: { id },
      data: { resolvedAt: new Date(Date.now() - 96 * 60 * 60 * 1000) },
    });

    const closed = await ticketService.autoCloseStale(new Date());
    expect(closed).toBeGreaterThanOrEqual(1);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("closed");

    // The sweep is not a confirmation: nobody agreed, so nothing claims they did.
    expect(
      await prisma.auditLog.findFirst({
        where: { entityId: id, action: "ticket.closure_confirmed" },
      }),
    ).toBeNull();
  });
});
