import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Two endings the desk does not own, and what happens to the thread afterwards.
 *
 * A requester could raise a ticket and then have no way to say they no longer
 * needed it — the only exits were the desk closing it or the 72h sweep, both of
 * which record work that was never done. And a closed ticket's conversation
 * stayed wide open: anyone could post into a thread nobody was watching, and the
 * message simply sat there.
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

const AGENT = "dana.reyes@acme.com";
const REQUESTER = "marcus.chen@acme.com";

/** A `new` ticket of Marcus's — the state a cancellation can leave from. */
async function newTicketOfMarcus(): Promise<number> {
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { requester: { email: REQUESTER }, status: "new", deletedAt: null },
    orderBy: { id: "asc" },
  });
  return ticket.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("the requester withdraws a ticket", () => {
  it("cancels one the desk has not moved, and says who did it", async () => {
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus))
      .send({ reason: "Sorted it myself, thanks." });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    expect(res.body.data.displayStatus).toBe("cancelled");

    // The reason went into the thread rather than into a column nobody opens.
    const comments = await prisma.comment.findMany({ where: { ticketId: id } });
    expect(comments.map((c) => c.body)).toContain("Sorted it myself, thanks.");

    // And a person decided this — the audit row is what separates a withdrawal
    // from any other way a ticket could have ended.
    expect(
      await prisma.auditLog.findFirst({
        where: { entityId: id, action: "ticket.cancelled" },
      }),
    ).not.toBeNull();
  });

  it("does not need a reason", async () => {
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("refuses somebody else's ticket with 403", async () => {
    const dana = await login(AGENT);
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(dana));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_YOUR_TICKET_TO_CANCEL");
    // Being an agent is not the point — holding `ticket:write` does not make
    // somebody's request yours to withdraw.
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("new");
  });

  it("refuses once the desk has moved it, naming where it went", async () => {
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      // Both moves out of `new` carry a resolution now — see `requiresResolution`.
      .send({ status: "pending", resolution: "Swapped the dock." })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_ALREADY_STARTED");
    expect(res.body.error.details.actual).toBe("pending");
  });

  it("still allows it once the ticket is merely ASSIGNED", async () => {
    // Assignment is not a status change — a ticket can carry somebody's name and
    // still be `new`. It is editable then (see `editOwnWording`) and it is
    // cancellable then, which is the right way round: the alternative is a
    // person who no longer wants a thing being unable to say so.
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    const agent = await prisma.user.findFirstOrThrow({ where: { email: AGENT } });
    await request(app)
      .patch(`${API}/tickets/${id}/assignee`)
      .set(bearer(dana))
      .send({ assigneeId: agent.id })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });
});

describe("cancelling is not the desk's move", () => {
  it("refuses `cancelled` on the desk's status endpoint", async () => {
    const dana = await login(AGENT);
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "cancelled" });

    // The transition whitelist says `new → cancelled` is a legal MOVE; it cannot
    // say who may make it. Keeping the value off this endpoint is what does.
    expect(res.status).toBe(400);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("new");
  });

  it("lets the desk take a withdrawal back, so it is not a trapdoor", async () => {
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus))
      .expect(200);

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "new" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
  });

  it("keeps a cancellation out of the closed archive", async () => {
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus))
      .expect(200);

    // `closedAt` is what dates the archive and the 30-day reopen window, and a
    // withdrawal belongs in neither.
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.closedAt).toBeNull();

    const dana = await login(AGENT);
    const log = await request(app)
      .get(`${API}/tickets/closed`)
      .set(bearer(dana));
    expect(log.status).toBe(200);
    expect(log.body.data.map((t: { id: number }) => t.id)).not.toContain(id);
  });
});

describe("a ticket that is over takes no more public messages", () => {
  /** Close `id` through the desk, which is the ordinary way one ends. */
  async function closeIt(id: number, token: string) {
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(token))
      .send({ status: "closed", resolution: "Handled and closed." })
      .expect(200);
  }

  it("refuses the requester a public comment on a closed ticket", async () => {
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await closeIt(id, dana);

    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(marcus))
      .send({ body: "One more thing", internal: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONVERSATION_CLOSED");
    expect(res.body.error.details.actual).toBe("closed");
  });

  it("refuses the DESK a public comment too, not just the requester", async () => {
    // Otherwise an agent emails somebody about a ticket they cannot answer.
    const dana = await login(AGENT);
    const id = await newTicketOfMarcus();
    await closeIt(id, dana);

    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(dana))
      .send({ body: "Just following up", internal: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONVERSATION_CLOSED");
  });

  it("refuses the agent's email reply, which is a public message by another route", async () => {
    const dana = await login(AGENT);
    const id = await newTicketOfMarcus();
    await closeIt(id, dana);

    const res = await request(app)
      .post(`${API}/tickets/${id}/reply`)
      .set(bearer(dana))
      .send({ to: REQUESTER, body: "Following up by mail" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONVERSATION_CLOSED");
  });

  it("still takes an internal note, which is the desk's own record", async () => {
    // The lock is on the CONVERSATION, not the ticket. A note written after the
    // fact — a supplier credits the invoice a week later — must not require
    // reopening the ticket and rewriting its status history to file.
    const dana = await login(AGENT);
    const id = await newTicketOfMarcus();
    await closeIt(id, dana);

    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(dana))
      .send({ body: "Supplier credited us on the 14th", internal: true });

    expect(res.status).toBe(201);
    expect(res.body.data.internal).toBe(true);
  });

  it("locks a cancelled ticket the same way", async () => {
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await request(app)
      .post(`${API}/tickets/${id}/cancel`)
      .set(bearer(marcus))
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(marcus))
      .send({ body: "Actually, I do need it", internal: false });

    expect(res.status).toBe(409);
    expect(res.body.error.details.actual).toBe("cancelled");
  });

  it("opens again when the ticket is reopened", async () => {
    // The lock is a fact about the state, not a one-way door: reopening a ticket
    // is what puts it back in front of the desk, and the thread comes with it.
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await closeIt(id, dana);
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "new" })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(marcus))
      .send({ body: "Thanks for reopening", internal: false });

    expect(res.status).toBe(201);
  });

  it("leaves the requester's confirm and reject alone", async () => {
    // `pending` is not an ending — the requester answering IS a public message,
    // and a lock that caught it would break the two-sided close entirely.
    const dana = await login(AGENT);
    const marcus = await login(REQUESTER);
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      // Both moves out of `new` carry a resolution now — see `requiresResolution`.
      .send({ status: "pending", resolution: "Swapped the dock." })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/reject`)
      .set(bearer(marcus))
      .send({ reason: "Still broken" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
  });
});
