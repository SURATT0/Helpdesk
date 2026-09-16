import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ticketService } from "../src/modules/tickets/ticket.service";
import { ticketRepository } from "../src/modules/tickets/ticket.repository";
import { prisma, resetDb } from "./db";

/**
 * Finishing a ticket has to say what was done.
 *
 * Until now a ticket could go all the way to `closed` carrying no account of
 * the fix at all — the desk's "Done" button sent `{ status: "pending" }` and
 * nothing else, so the record of how a problem was solved existed only if
 * somebody happened to write it in the thread. These tests pin the rule that
 * replaced that, and — more importantly — pin the four moves it must NOT catch.
 * A rule written as "every close explains itself" would refuse the requester's
 * confirmation and break the 72h sweep, which is why it is keyed on the pair.
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

/** A `new` ticket of Marcus's, which the desk has not finished yet. */
async function newTicketOfMarcus(): Promise<number> {
  const ticket = await prisma.ticket.findFirstOrThrow({
    where: {
      requester: { email: "marcus.chen@acme.com" },
      status: "new",
      deletedAt: null,
    },
    orderBy: { id: "asc" },
  });
  return ticket.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("the desk must say what it did", () => {
  it("refuses new → pending with no resolution", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RESOLUTION_REQUIRED");
    // The field is named so a form can point at it rather than showing the
    // sentence somewhere generic.
    expect(res.body.error.details.fields).toEqual(["resolution"]);

    // And nothing moved: a refused finish leaves the ticket where it was, with
    // no history row claiming otherwise.
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("new");
    expect(after.resolvedAt).toBeNull();
  });

  it("refuses new → closed with no resolution", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "closed" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RESOLUTION_REQUIRED");
  });

  it("refuses a resolution that is only whitespace", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending", resolution: "   \n  " });

    // Caught by the validator rather than the service — `freeText` trims first,
    // so "typed some spaces to get past it" never reaches the transition at all.
    expect(res.status).toBe(400);
  });

  it("stores what was written and sends it back on the ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({
        status: "pending",
        resolution: "Replaced the dock; firmware was two versions behind.",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.resolution).toBe(
      "Replaced the dock; firmware was two versions behind.",
    );
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(row.resolution).toBe(
      "Replaced the dock; firmware was two versions behind.",
    );
  });
});

describe("the moves it must not catch", () => {
  it("lets the requester confirm without one — they did not do the work", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending", resolution: "Rebuilt the index." })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/confirm`)
      .set(bearer(marcus));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    // The desk's account survives the confirmation rather than being cleared by
    // a move that carried none.
    expect(res.body.data.resolution).toBe("Rebuilt the index.");
  });

  it("lets the 72h sweep close a pending ticket that has no answer", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending", resolution: "Cleared the mailbox rule." })
      .expect(200);
    await prisma.ticket.update({
      where: { id },
      data: { resolvedAt: new Date(Date.now() - 96 * 60 * 60 * 1000) },
    });

    // The sweep has no actor and writes no resolution. If the rule were keyed
    // on the destination it would throw here and the sweep would stop closing
    // anything — which is the regression this test exists for.
    const closed = await ticketService.autoCloseStale(new Date());
    expect(closed).toBeGreaterThanOrEqual(1);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("closed");
    expect(after.resolution).toBe("Cleared the mailbox rule.");
  });

  it("lets a rejection go back without one — it carries its own reason", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending", resolution: "Swapped the keyboard." })
      .expect(200);

    const res = await request(app)
      .post(`${API}/tickets/${id}/closure/reject`)
      .set(bearer(marcus))
      .send({ reason: "Still doubles every letter." });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
    // Kept, not cleared: the account of what was tried is the most useful thing
    // for whoever picks it up again, and the next finish overwrites it.
    expect(res.body.data.resolution).toBe("Swapped the keyboard.");
  });

  it("lets a closed ticket be reopened without one", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "closed", resolution: "Wrong department; redirected." })
      .expect(200);

    const res = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "new" });

    expect(res.status).toBe(200);
    expect(res.body.data.resolution).toBe("Wrong department; redirected.");
  });

  it("treats a re-sent identical status as a no-op, not a second finish", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await newTicketOfMarcus();
    const finish = () =>
      request(app)
        .patch(`${API}/tickets/${id}/status`)
        .set(bearer(dana))
        .send({ status: "pending", resolution: "Reinstalled the driver." });

    expect((await finish()).status).toBe(200);
    // Nobody redid the work, so the second call is not asked to describe it —
    // and with no resolution at all it is still a no-op rather than a 400.
    const again = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(again.status).toBe(200);
    expect(again.body.data.resolution).toBe("Reinstalled the driver.");
  });
});

describe("the repository enforces it too, not just the service", () => {
  it("refuses a finish with no resolution even when called directly", async () => {
    const id = await newTicketOfMarcus();

    // The service checks first so an ordinary caller gets the error before a
    // transaction opens. This is the copy that cannot be gone around — the same
    // belt-and-braces the transition whitelist already had, and the reason a
    // future code path that writes status directly cannot quietly skip the rule.
    await expect(
      ticketRepository.updateStatus(id, "pending", 1),
    ).rejects.toMatchObject({ code: "RESOLUTION_REQUIRED" });

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("new");
  });
});
