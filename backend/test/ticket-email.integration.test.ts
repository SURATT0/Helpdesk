import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { emailOutboxService } from "../src/modules/emails/email-outbox.service";
import { prisma, resetDb } from "./db";

/**
 * Outbound ticket email, end to end against a real database.
 *
 * The unit suites cover the recipient rules and the sweep's decisions. What only
 * a database can answer is asserted here: that the idempotency constraint really
 * does swallow a repeated event, that a queued row carries what the sweep will
 * need, and that a mailed reply lands back on its own ticket instead of opening
 * a second one.
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

/** Queued mail for a ticket, with the recipient's address joined in. */
async function queued(ticketId: number) {
  return prisma.emailOutbox.findMany({
    where: { ticketId },
    orderBy: { id: "asc" },
    select: {
      eventType: true,
      recipientEmail: true,
      recipientUserId: true,
      lang: true,
      status: true,
      payload: true,
    },
  });
}

async function ticketOf(email: string): Promise<{
  id: number;
  requesterId: number;
  assigneeId: number | null;
}> {
  const t = await prisma.ticket.findFirstOrThrow({
    where: { requester: { email }, deletedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, requesterId: true, assigneeId: true },
  });
  return t;
}

beforeEach(async () => {
  await resetDb();
});

describe("an internal note never reaches the requester", () => {
  it("queues nothing addressed to the person who raised the ticket", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    // Park it with an agent who is NOT the one writing the note, so there is a
    // real recipient to check against. With the author holding it themselves the
    // list is empty for a different (also correct) reason, and the assertion
    // would pass without proving anything.
    const kai = await prisma.user.findUniqueOrThrow({
      where: { email: "kai.t@acme.com" },
      select: { id: true },
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId: kai.id },
    });
    const dana = await login("dana.reyes@acme.com");

    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: "Vendor says the fuser batch is faulty — internal only", internal: true })
      .expect(201);

    const rows = await queued(ticket.id);
    const notes = rows.filter((r) => r.eventType === "comment.internal_note");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.map((r) => r.recipientUserId)).not.toContain(ticket.requesterId);
    expect(notes.map((r) => r.recipientEmail)).not.toContain("marcus.chen@acme.com");
  });

  it("keeps the note's text out of every requester-bound mail on that ticket", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    const dana = await login("dana.reyes@acme.com");
    const SECRET = "internal-only-vendor-detail-do-not-forward";

    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: SECRET, internal: true })
      .expect(201);
    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: "We are still looking into it.", internal: false })
      .expect(201);

    const rows = await queued(ticket.id);
    const toRequester = rows.filter(
      (r) => r.recipientUserId === ticket.requesterId,
    );
    expect(toRequester.length).toBeGreaterThan(0);
    for (const row of toRequester) {
      expect(JSON.stringify(row.payload)).not.toContain(SECRET);
    }
  });
});

describe("a public reply does reach the requester", () => {
  it("queues one mail to them, in their own language", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    await prisma.user.update({
      where: { id: ticket.requesterId },
      data: { language: "th" },
    });
    const dana = await login("dana.reyes@acme.com");

    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: "Replacement part ordered.", internal: false })
      .expect(201);

    const replies = (await queued(ticket.id)).filter(
      (r) => r.eventType === "comment.public_reply",
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      recipientUserId: ticket.requesterId,
      recipientEmail: "marcus.chen@acme.com",
      lang: "th",
      status: "pending",
    });
  });

  it("does not queue the reply back to the agent who wrote it", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    const dana = await login("dana.reyes@acme.com");
    const danaUser = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
      select: { id: true },
    });

    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: "On it.", internal: false })
      .expect(201);

    const rows = await queued(ticket.id);
    expect(rows.map((r) => r.recipientUserId)).not.toContain(danaUser.id);
  });
});

describe("idempotency", () => {
  // The unique key is (ticket, event, cause, recipient). Re-running the SLA
  // sweep re-examines the same tickets every time and must not re-queue them.
  it("queues one mail however many times the same event is replayed", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    const ctx = {
      ticketId: ticket.id,
      customerId: (
        await prisma.ticket.findUniqueOrThrow({
          where: { id: ticket.id },
          select: { customerId: true },
        })
      ).customerId,
      requesterId: ticket.requesterId,
      assigneeId: ticket.assigneeId,
      categoryId: (
        await prisma.ticket.findUniqueOrThrow({
          where: { id: ticket.id },
          select: { categoryId: true },
        })
      ).categoryId,
      actorId: null,
    };
    const req = {
      event: "ticket.sla_breach" as const,
      ctx,
      sourceRecordId: ticket.id,
      ticket: {
        id: ticket.id,
        subject: "s",
        displayStatus: "in_progress" as const,
        priority: "high" as const,
        category: "Hardware",
        requesterName: "Marcus Chen",
        assigneeName: null,
      },
      occurredAt: new Date(),
    };

    const first = await emailOutboxService.queue(req);
    const second = await emailOutboxService.queue(req);
    const third = await emailOutboxService.queue(req);

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(third).toBe(0);
    const rows = (await queued(ticket.id)).filter(
      (r) => r.eventType === "ticket.sla_breach",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("a requester with no usable address", () => {
  // "Skip quietly, record why, never throw" — the user's action has to succeed
  // whatever the state of their contact details.
  it("does not fail the comment, and says why nothing was sent", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    await prisma.user.update({
      where: { id: ticket.requesterId },
      data: { isActive: false },
    });
    const dana = await login("dana.reyes@acme.com");

    await request(app)
      .post(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(dana))
      .send({ body: "Any update?", internal: false })
      .expect(201);

    const rows = (await queued(ticket.id)).filter(
      (r) => r.eventType === "comment.public_reply",
    );
    expect(rows).toHaveLength(0);
    const suppressed = await prisma.auditLog.findMany({
      where: { action: "email.suppressed", entityId: ticket.id },
    });
    expect(suppressed.length).toBeGreaterThan(0);
    expect(
      (suppressed[0].meta as { reason?: string } | null)?.reason,
    ).toBe("recipient_inactive_or_unreachable");
  });
});

describe("a mailed reply comes back to its own ticket", () => {
  it("threads onto the existing ticket instead of opening a second one", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    const before = await prisma.ticket.count();

    const res = await request(app)
      .post(`${API}/integrations/email-inbound`)
      .set("x-webhook-secret", "test-webhook-secret")
      .send({
        from: "Marcus Chen <marcus.chen@acme.com>",
        subject: `Re: [Deskly #${ticket.id}] Printer jam`,
        text: "Still not fixed.",
        "message-id": "<reply-1@mail.example.com>",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("comment");
    expect(res.body.data.ticketId).toBe(ticket.id);
    expect(await prisma.ticket.count()).toBe(before);
  });

  // Mail we sent before the tag was branded is still in people's mailboxes.
  it("still recognises the older unbranded tag", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");
    const before = await prisma.ticket.count();

    const res = await request(app)
      .post(`${API}/integrations/email-inbound`)
      .set("x-webhook-secret", "test-webhook-secret")
      .send({
        from: "marcus.chen@acme.com",
        subject: `RE: [#${ticket.id}] Printer jam`,
        text: "Any news?",
        "message-id": "<reply-2@mail.example.com>",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ticketId).toBe(ticket.id);
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("queues the desk's copy when the requester answers by mail", async () => {
    const ticket = await ticketOf("marcus.chen@acme.com");

    await request(app)
      .post(`${API}/integrations/email-inbound`)
      .set("x-webhook-secret", "test-webhook-secret")
      .send({
        from: "marcus.chen@acme.com",
        subject: `Re: [Deskly #${ticket.id}] Printer jam`,
        text: "Still broken.",
        "message-id": "<reply-3@mail.example.com>",
      })
      .expect(201);

    const rows = await queued(ticket.id);
    const toDesk = rows.filter((r) =>
      ["comment.requester_replied", "queue.requester_replied"].includes(
        r.eventType,
      ),
    );
    expect(toDesk.length).toBeGreaterThan(0);
    expect(toDesk.map((r) => r.recipientUserId)).not.toContain(
      ticket.requesterId,
    );
  });
});

describe("the ticket a nobody owns", () => {
  it("tells the category's queue when an unassigned ticket arrives", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(marcus))
      .send({
        subject: "Nobody is going to see this one",
        description: "The #1046 shape",
        priority: "high",
        categoryId: 3, // Hardware
      });
    expect(res.status).toBe(201);
    const id = res.body.data.id as number;

    const rows = await queued(id);
    // The acknowledgement always goes out; whether the queue is told depends on
    // whether the seed routed this ticket to somebody.
    expect(rows.map((r) => r.eventType)).toContain("ticket.created");
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: { assigneeId: true },
    });
    if (ticket.assigneeId == null) {
      const queueRows = rows.filter(
        (r) => r.eventType === "queue.ticket_unassigned",
      );
      // Either somebody was told, or the reason nobody was is on the record.
      const suppressed = await prisma.auditLog.count({
        where: { action: "email.suppressed", entityId: id },
      });
      expect(queueRows.length + suppressed).toBeGreaterThan(0);
    }
  });
});

describe("the acknowledgement", () => {
  // The one mail deliberately sent to the person who acted: a receipt naming the
  // number to quote is addressed to the requester BECAUSE they just raised it.
  it("goes to the requester even though they are the actor", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(marcus))
      .send({
        subject: "New laptop please",
        description: "Mine is dying",
        priority: "low",
        categoryId: 3, // Hardware
      })
      .expect(201);

    const rows = (await queued(res.body.data.id)).filter(
      (r) => r.eventType === "ticket.created",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientEmail).toBe("marcus.chen@acme.com");
  });
});
