import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ticketRepository } from "../src/modules/tickets/ticket.repository";
import { prisma, resetDb } from "./db";

/**
 * The requester correcting their own words, and the moment that stops.
 *
 * Two conditions, and the second is the interesting one. "The desk has started"
 * is NOT "somebody has been assigned": a ticket can sit assigned to an agent who
 * has not looked at it, and fixing a typo then is exactly when it helps. What
 * closes the door is an ANSWER — a public reply, or the ticket having moved out
 * of `new` at all.
 *
 * The signal is the same one SLA's first-response clock reads (a public comment
 * whose author is not the requester tier), rather than a second column saying
 * the same thing in a way that could drift from it.
 */

const app = createApp();
const API = "/api/v1";

const REQUESTER = "marcus.chen@acme.com";
const OTHER_REQUESTER = "t.alvarez@acme.com";
const AGENT = "dana.reyes@acme.com";
const PASSWORD = "password123";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return res.body.data.accessToken as string;
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const edit = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).patch(`${API}/tickets/${id}`).set(bearer(token)).send(body);

const GOOD = { subject: "Corrected subject", description: "Corrected body." };

/** A ticket this requester raised, `new`, with nothing said on it yet. */
async function ownTicket(over: Record<string, unknown> = {}) {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { email: REQUESTER },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { customerId: requester.customerId! },
  });
  return prisma.ticket.create({
    data: {
      subject: "Original subject",
      description: "Original body.",
      status: "new",
      requesterId: requester.id,
      categoryId: category.id,
      customerId: requester.customerId!,
      ...over,
    },
  });
}

async function agentComments(ticketId: number, internal = false) {
  const agent = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
  return prisma.comment.create({
    data: { ticketId, authorId: agent.id, body: "Looking into it.", internal },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("a requester may correct their own wording", () => {
  it("edits an open ticket nobody has been assigned to", async () => {
    const ticket = await ownTicket();
    const res = await edit(await login(REQUESTER), ticket.id, GOOD);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject(GOOD);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.subject).toBe(GOOD.subject);
  });

  it("edits an ASSIGNED ticket the agent has not touched", async () => {
    // The case the rule exists for. Assignment is not work: "In Progress" here
    // is `new` plus an assignee and nothing more, so a ticket can look busy on
    // the board while nobody has read it. The requester keeps the pen until
    // somebody answers.
    const agent = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
    const ticket = await ownTicket({ assigneeId: agent.id });

    const res = await edit(await login(REQUESTER), ticket.id, GOOD);
    expect(res.status, "assigned but unanswered must still be editable").toBe(200);
  });

  it("leaves an internal note alone — that is not an answer", async () => {
    // Consistent with SLA, which counts only public replies as a first response.
    // Two definitions of "the desk answered" would eventually disagree.
    const ticket = await ownTicket();
    await agentComments(ticket.id, true);

    const res = await edit(await login(REQUESTER), ticket.id, GOOD);
    expect(res.status).toBe(200);
  });
});

describe("and stops when the desk has answered", () => {
  it("refuses once an agent has replied publicly, and says why", async () => {
    const ticket = await ownTicket();
    await agentComments(ticket.id);

    const res = await edit(await login(REQUESTER), ticket.id, GOOD);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DESK_ALREADY_STARTED");
    // The wording has to point at the way forward — a comment — rather than
    // saying "no permission", which is both wrong and a dead end.
    expect(res.body.error.message).toMatch(/comment/i);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.subject).toBe("Original subject");
  });

  it("refuses once the ticket has moved out of `new`", async () => {
    // `pending` is the desk saying the work is done. There is no stored
    // `in_progress` in this system — see the enum — so "moved out of new" is
    // what "an agent changed the status" means here.
    const ticket = await ownTicket({ status: "pending" });
    const res = await edit(await login(REQUESTER), ticket.id, GOOD);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DESK_ALREADY_STARTED");
  });

  it("says CLOSED when it is closed, not the same sentence as the rest", async () => {
    const ticket = await ownTicket({ status: "closed", closedAt: new Date() });
    const res = await edit(await login(REQUESTER), ticket.id, GOOD);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_CLOSED_FOR_EDITING");
    expect(res.body.error.message).toMatch(/closed/i);
    // The distinction is the point: "closed" and "somebody is working on it"
    // call for different next moves, and one shared refusal would tell the
    // reader neither.
    expect(res.body.error.code).not.toBe("DESK_ALREADY_STARTED");
  });
});

describe("whose ticket it is", () => {
  it("refuses another requester's ticket in their own tenant", async () => {
    const ticket = await ownTicket();
    const res = await edit(await login(OTHER_REQUESTER), ticket.id, GOOD);
    // 404, not 403: a requester cannot see other people's tickets at all, so
    // row scope answers before ownership is ever asked. Confirming it exists
    // would be the leak.
    expect(res.status).toBe(404);
  });

  it("refuses an agent, who has the thread instead", async () => {
    // Rewriting somebody else's account of their own problem is not an edit.
    const ticket = await ownTicket();
    const res = await edit(await login(AGENT), ticket.id, GOOD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_YOUR_TICKET_TO_EDIT");
  });
});

describe("the race between saving and being answered", () => {
  /**
   * The case a form-time check cannot cover.
   *
   * The requester opened the editor when the ticket was untouched, and an agent
   * replies while they are typing. Checking only at submit is still not enough
   * on its own — a reply can land between that check and the write — so the
   * decision is taken again INSIDE the write's transaction. This drives the
   * repository directly, which is where that guard lives.
   */
  it("refuses a save whose conditions stopped holding, and writes nothing", async () => {
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const ticket = await ownTicket();

    // The reply the requester never saw.
    await agentComments(ticket.id);

    const result = await ticketRepository.updateOwnWording(
      ticket.id,
      requester.id,
      GOOD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("started");

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.subject).toBe("Original subject");
    expect(row.description).toBe("Original body.");
  });

  it("the guard is in the write, not only in the service", async () => {
    // Called with no service pre-check at all: the transaction alone must refuse.
    // If this ever passes, the check has drifted up out of the write and the
    // race is back.
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const ticket = await ownTicket({ status: "pending" });

    const result = await ticketRepository.updateOwnWording(
      ticket.id,
      requester.id,
      GOOD,
    );
    expect(result.ok).toBe(false);
  });

  it("records the edit in the audit trail when it does go through", async () => {
    const ticket = await ownTicket();
    await edit(await login(REQUESTER), ticket.id, GOOD).expect(200);

    const rows = await prisma.auditLog.findMany({
      where: { action: "ticket.edit", entityId: ticket.id },
    });
    expect(rows).toHaveLength(1);
  });
});
