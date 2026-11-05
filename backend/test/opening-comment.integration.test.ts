import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * The message a ticket is raised with, as a row.
 *
 * It existed only as `tickets.description`, re-rendered by the thread as a
 * bubble that was never in the database. That is why a file picked on the
 * new-ticket form had nowhere to belong: an attachment points at a COMMENT, and
 * there was no comment until somebody replied.
 *
 * Tickets raised before this are deliberately NOT backfilled — writing an
 * author and a timestamp for conversations that already happened invents
 * history — so `openingCommentId` being null has to keep meaning "render the
 * description yourself", not "this ticket has no description".
 */

const app = createApp();
const API = "/api/v1";
const REQUESTER = "marcus.chen@acme.com";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function raise(token: string, description: string) {
  // Not "Other": that one demands its own description and would 400 here for a
  // reason that has nothing to do with what these cases are about.
  const category = await prisma.category.findFirstOrThrow({
    where: { customer: { name: "Acme Corp" }, code: { not: "OTHER" } },
  });
  const res = await request(app)
    .post(`${API}/tickets`)
    .set(bearer(token))
    .send({
      subject: `Opening comment ${Date.now()}`,
      description,
      categoryId: category.id,
      priority: "medium",
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: number; openingCommentId: number | null };
}

beforeEach(async () => {
  await resetDb();
});

describe("raising a ticket", () => {
  it("writes the description as the thread's first message", async () => {
    const token = await login(REQUESTER);
    const ticket = await raise(token, "The printer is on fire.");

    expect(ticket.openingCommentId).toBeTypeOf("number");

    const row = await prisma.comment.findUniqueOrThrow({
      where: { id: ticket.openingCommentId! },
    });
    expect(row.ticketId).toBe(ticket.id);
    expect(row.body).toBe("The printer is on fire.");
    expect(row.isOpening).toBe(true);
    expect(row.internal).toBe(false);
    // Authored by the person who raised it, not by whoever happened to call.
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    expect(row.authorId).toBe(requester.id);
  });

  it("dates it with the ticket, not with whenever the insert ran", async () => {
    // A thread that opens with a message stamped after the ticket it opens
    // sorts wrong the first time anybody replies within the same second.
    const token = await login(REQUESTER);
    const ticket = await raise(token, "Timestamps matter.");
    const [row, t] = await Promise.all([
      prisma.comment.findUniqueOrThrow({ where: { id: ticket.openingCommentId! } }),
      prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }),
    ]);
    expect(row.createdAt.getTime()).toBe(t.createdAt.getTime());
  });

  it("sends one email for the new ticket, not two", async () => {
    // `commentRepository.create` queues mail in its own transaction, so routing
    // the opening message through it would notify twice for one event. The
    // creation path writes the row directly for exactly this reason.
    const token = await login(REQUESTER);
    const ticket = await raise(token, "Only one notification, please.");

    // Scoped to THIS ticket, so a sweep or another case cannot move the count.
    const queued = await prisma.emailOutbox.findMany({
      where: { ticketId: ticket.id },
      select: { eventType: true },
    });
    expect(queued.map((q) => q.eventType)).toEqual(["ticket.created"]);
    expect(ticket.openingCommentId).toBeTypeOf("number");
  });

  it("puts it in the thread once — the description is not repeated", async () => {
    const token = await login(REQUESTER);
    const ticket = await raise(token, "Exactly once.");
    const thread = await request(app)
      .get(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(token));
    expect(thread.status).toBe(200);
    const bodies = (thread.body.data as { body: string }[]).map((c) => c.body);
    expect(bodies.filter((b) => b === "Exactly once.")).toHaveLength(1);
  });
});

describe("files picked while raising it", () => {
  it("belong to the opening message, not to the ticket alone", async () => {
    const token = await login(REQUESTER);
    const ticket = await raise(token, "Screenshot attached.");

    const up = await request(app)
      .post(`${API}/tickets/${ticket.id}/attachments`)
      .set(bearer(token))
      .field("commentId", String(ticket.openingCommentId))
      .attach("file", PNG, { filename: "shot.png", contentType: "image/png" });
    expect(up.status).toBe(201);

    // The row points at the message — which is the whole change.
    const att = await prisma.attachment.findUniqueOrThrow({
      where: { id: up.body.data.id },
    });
    expect(att.commentId).toBe(ticket.openingCommentId);

    // And the agent reading the thread gets it inside that message.
    const agent = await login("dana.reyes@acme.com");
    const thread = await request(app)
      .get(`${API}/tickets/${ticket.id}/comments`)
      .set(bearer(agent));
    const opening = (thread.body.data as { id: number; attachments: unknown[] }[]).find(
      (c) => c.id === ticket.openingCommentId,
    );
    expect(opening?.attachments).toHaveLength(1);
  });
});

describe("a ticket from before the column existed", () => {
  it("reports no opening comment, so the thread knows to render the description", async () => {
    // The seeded tickets predate this: they were written straight into the
    // table with no comment of their own, which is exactly the shape every
    // existing row has after the migration, since it backfills nothing.
    const token = await login(REQUESTER);
    const seeded = await prisma.ticket.findFirstOrThrow({
      where: { requester: { email: REQUESTER }, deletedAt: null },
      orderBy: { id: "asc" },
    });
    const res = await request(app)
      .get(`${API}/tickets/${seeded.id}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.openingCommentId).toBeNull();
    // The description is still there to fall back on.
    expect(res.body.data.description).toBeTruthy();
  });
});
