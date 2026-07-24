import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ticketService } from "../src/modules/tickets/ticket.service";
import { prisma, resetDb } from "./db";

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

// Pull the `deskly_rt=<value>` pair out of a Set-Cookie response header.
function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers["set-cookie"] as string[] | undefined;
  const raw = (cookies ?? []).find((c) => c.startsWith("deskly_rt="));
  if (!raw) throw new Error("no refresh cookie in response");
  return raw.split(";")[0];
}

async function categoryId(name: string): Promise<number> {
  const c = await prisma.category.findUniqueOrThrow({ where: { name } });
  return c.id;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth", () => {
  it("logs in with valid credentials and sets a refresh cookie", async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: "dana.reyes@acme.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe("string");
    expect(res.body.data.user.email).toBe("dana.reyes@acme.com");
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("deskly_rt="))).toBe(true);
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: "dana.reyes@acme.com", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401, not 500 (no enumeration)", async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: "nobody@acme.com", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("blocks a protected route without a token", async () => {
    const res = await request(app).get(`${API}/tickets`);
    expect(res.status).toBe(401);
  });
});

describe("tickets — RBAC row scoping", () => {
  it("scopes an agent to their team's queue (not another team's ticket)", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent, IT Support
    const res = await request(app).get(`${API}/tickets`).set(bearer(dana));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).not.toContain(1029); // assigned to Field Services
    expect(ids).toContain(1042);
  });

  it("scopes a requester to only their own tickets", async () => {
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const res = await request(app).get(`${API}/tickets`).set(bearer(marcus));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toEqual([1042]);
  });

  it("404s an out-of-scope ticket instead of leaking it", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app).get(`${API}/tickets/1039`).set(bearer(marcus));
    expect(res.status).toBe(404);
  });
});

describe("tickets — status transitions", () => {
  it("allows a legal transition and appends a history row", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1035/status`) // open → in_progress
      .set(bearer(dana))
      .send({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in_progress");
    const history = await prisma.ticketStatusHistory.count({
      where: { ticketId: 1035 },
    });
    expect(history).toBe(2); // initial + this change
  });

  it("rejects an illegal transition with 409", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1042/status`) // in_progress → closed (illegal)
      .set(bearer(dana))
      .send({ status: "closed" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("forbids a requester from changing status (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(marcus))
      .send({ status: "open" });
    expect(res.status).toBe(403);
  });

  it("404s a status change on an out-of-scope ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1029/status`)
      .set(bearer(dana))
      .send({ status: "in_progress" });
    expect(res.status).toBe(404);
  });
});

describe("tickets — reopen window (30 days)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it("allows reopening a ticket closed within 30 days", async () => {
    const dana = await login("dana.reyes@acme.com"); // assignee of 1031
    await prisma.ticket.update({
      where: { id: 1031 },
      data: { status: "closed", closedAt: daysAgo(5) },
    });
    const res = await request(app)
      .patch(`${API}/tickets/1031/status`)
      .set(bearer(dana))
      .send({ status: "open" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("open");
  });

  it("rejects reopening a ticket closed more than 30 days ago (409)", async () => {
    const dana = await login("dana.reyes@acme.com");
    await prisma.ticket.update({
      where: { id: 1031 },
      data: { status: "closed", closedAt: daysAgo(31) },
    });
    const res = await request(app)
      .patch(`${API}/tickets/1031/status`)
      .set(bearer(dana))
      .send({ status: "open" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REOPEN_WINDOW_EXPIRED");
  });
});

describe("tickets — auto-close (resolved > 72h)", () => {
  it("closes a ticket left resolved beyond 72h and logs the transition", async () => {
    await prisma.ticket.update({
      where: { id: 1031 }, // seeded as resolved
      data: { resolvedAt: new Date(Date.now() - 73 * 60 * 60 * 1000) },
    });

    const closed = await ticketService.autoCloseStale(new Date());
    expect(closed).toBeGreaterThanOrEqual(1);

    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: 1031 } });
    expect(t.status).toBe("closed");
    expect(t.closedAt).not.toBeNull();
    const hist = await prisma.ticketStatusHistory.findFirst({
      where: { ticketId: 1031, toStatus: "closed" },
    });
    expect(hist).not.toBeNull();
  });

  it("leaves recently-resolved tickets open", async () => {
    // #1031 was seeded resolved just now → not stale
    const closed = await ticketService.autoCloseStale(new Date());
    expect(closed).toBe(0);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: 1031 } });
    expect(t.status).toBe("resolved");
  });
});

describe("tickets — create", () => {
  it("creates a ticket (201) with the caller as requester", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "New keyboard is unresponsive",
        description: "Several keys stopped working.",
        categoryId: await categoryId("Hardware"),
        priority: "high",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("new");
    expect(res.body.data.requester).toBe("Dana Reyes");
  });

  it("rejects an unknown category with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({ subject: "Valid subject", description: "x", categoryId: 999999 });
    expect(res.status).toBe(400);
  });

  it("rejects a too-short subject with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({ subject: "hi", description: "x", categoryId: await categoryId("Hardware") });
    expect(res.status).toBe(400);
  });
});

describe("tickets — general unassigned queue (category with no default team)", () => {
  it("shows a team-less unassigned ticket to any agent, but not to an unrelated requester", async () => {
    const category = await prisma.category.create({
      data: { name: "Uncategorized", defaultTeamId: null },
    });
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: "t.alvarez@acme.com" },
    });
    const orphan = await prisma.ticket.create({
      data: {
        subject: "Orphan ticket in a team-less category",
        description: "no category routing",
        status: "new",
        priority: "medium",
        requesterId: requester.id,
        categoryId: category.id,
        dueAt: new Date(Date.now() + 3_600_000),
      },
    });

    const idsFor = async (token: string) => {
      const res = await request(app).get(`${API}/tickets`).set(bearer(token));
      return (res.body.data as { id: number }[]).map((t) => t.id);
    };

    const dana = await login("dana.reyes@acme.com"); // agent, IT Support
    const kai = await login("kai.t@acme.com"); // agent, Field Services
    const marcus = await login("marcus.chen@acme.com"); // requester (not this ticket's)

    expect(await idsFor(dana)).toContain(orphan.id);
    expect(await idsFor(kai)).toContain(orphan.id);
    expect(await idsFor(marcus)).not.toContain(orphan.id);
  });
});

describe("auth — refresh rotation & reuse detection", () => {
  const creds = { email: "dana.reyes@acme.com", password: "password123" };

  it("rotates the refresh token and revokes the family on reuse", async () => {
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send(creds)
      .expect(200);
    const rt1 = refreshCookie(login);

    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    const rt2 = refreshCookie(refreshed);
    expect(rt2).not.toBe(rt1);

    // Replaying the rotated (now revoked) token is treated as reuse → 401 and
    // nukes the whole family, so the freshly-minted rt2 is invalidated too.
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt1).expect(401);
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt2).expect(401);
  });

  it("401s a refresh with no cookie", async () => {
    await request(app).post(`${API}/auth/refresh`).expect(401);
  });

  it("logout revokes the session so refresh fails afterwards", async () => {
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send(creds)
      .expect(200);
    const rt = refreshCookie(login);
    await request(app).post(`${API}/auth/logout`).set("Cookie", rt).expect(200);
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt).expect(401);
  });
});

describe("users — directory & role management (RBAC)", () => {
  it("lets staff read the directory but blocks requesters (403)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");

    const asDana = await request(app).get(`${API}/users`).set(bearer(dana));
    expect(asDana.status).toBe(200);
    expect(asDana.body.data.length).toBeGreaterThan(0);

    await request(app).get(`${API}/users`).set(bearer(marcus)).expect(403);
  });

  it("only an admin can change a role", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });

    await request(app)
      .patch(`${API}/users/${marcus.id}`)
      .set(bearer(dana))
      .send({ role: "agent" })
      .expect(403);

    // Promote a user to admin, then the write succeeds.
    await prisma.user.update({
      where: { email: "ana.m@acme.com" },
      data: { role: "admin" },
    });
    const ana = await login("ana.m@acme.com");
    const res = await request(app)
      .patch(`${API}/users/${marcus.id}`)
      .set(bearer(ana))
      .send({ role: "manager" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("manager");
  });
});

describe("notifications", () => {
  it("notifies the requester on a status change, not the actor; supports read", async () => {
    const dana = await login("dana.reyes@acme.com"); // assignee of 1042
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042

    await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(dana))
      .send({ status: "resolved" })
      .expect(200);

    const marcusN = await request(app)
      .get(`${API}/notifications`)
      .set(bearer(marcus));
    expect(marcusN.status).toBe(200);
    expect(marcusN.body.meta.unread).toBe(1);
    expect(marcusN.body.data[0].ticketId).toBe(1042);

    // Actor is not notified about their own action.
    const danaN = await request(app)
      .get(`${API}/notifications`)
      .set(bearer(dana));
    expect(danaN.body.meta.unread).toBe(0);

    await request(app)
      .post(`${API}/notifications/${marcusN.body.data[0].id}/read`)
      .set(bearer(marcus))
      .expect(204);
    const after = await request(app)
      .get(`${API}/notifications`)
      .set(bearer(marcus));
    expect(after.body.meta.unread).toBe(0);
  });
});

describe("attachments", () => {
  it("uploads, lists, and downloads a file", async () => {
    const dana = await login("dana.reyes@acme.com");
    const up = await request(app)
      .post(`${API}/tickets/1042/attachments`)
      .set(bearer(dana))
      .attach("file", Buffer.from("hello attachment"), {
        filename: "log.txt",
        contentType: "text/plain",
      });
    expect(up.status).toBe(201);
    expect(up.body.data.filename).toBe("log.txt");

    const list = await request(app)
      .get(`${API}/tickets/1042/attachments`)
      .set(bearer(dana));
    expect(list.body.data).toHaveLength(1);

    const dl = await request(app)
      .get(`${API}/attachments/${up.body.data.id}`)
      .set(bearer(dana));
    expect(dl.status).toBe(200);
    expect(dl.text).toContain("hello attachment");
  });

  it("rejects a disallowed content type with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/1042/attachments`)
      .set(bearer(dana))
      .attach("file", Buffer.from("x"), {
        filename: "x.bin",
        contentType: "application/octet-stream",
      });
    expect(res.status).toBe(400);
  });
});

describe("tickets — status history", () => {
  it("returns the scoped status timeline and appends on change", async () => {
    const dana = await login("dana.reyes@acme.com");
    const before = await request(app)
      .get(`${API}/tickets/1042/history`)
      .set(bearer(dana));
    expect(before.status).toBe(200);
    const n0 = before.body.data.length; // seeded creation row

    await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(dana))
      .send({ status: "resolved" })
      .expect(200);

    const after = await request(app)
      .get(`${API}/tickets/1042/history`)
      .set(bearer(dana));
    expect(after.body.data).toHaveLength(n0 + 1);
    expect(after.body.data[0].toStatus).toBe("resolved"); // newest first
  });

  it("404s history for an out-of-scope ticket", async () => {
    const marcus = await login("marcus.chen@acme.com");
    await request(app)
      .get(`${API}/tickets/1039/history`)
      .set(bearer(marcus))
      .expect(404);
  });
});

describe("comments — internal notes", () => {
  it("hides internal notes from the requester but shows public replies", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");

    await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "Public reply" })
      .expect(201);
    await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "Internal note", internal: true })
      .expect(201);

    const asMarcus = await request(app)
      .get(`${API}/tickets/1042/comments`)
      .set(bearer(marcus));
    expect(asMarcus.status).toBe(200);
    const bodies: string[] = asMarcus.body.data.map(
      (c: { body: string }) => c.body,
    );
    expect(bodies).toContain("Public reply");
    expect(bodies).not.toContain("Internal note");
  });

  it("forbids a requester from posting an internal note (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(marcus))
      .send({ body: "secret", internal: true });
    expect(res.status).toBe(403);
  });
});

describe("tickets — CSV import (importMany)", () => {
  const row = (over: Partial<Record<string, string>> = {}) => ({
    subject: "Imported subject",
    description: "Imported description",
    priority: "high",
    category: "Hardware",
    requesterEmail: "marcus.chen@acme.com",
    ...over,
  });

  it("imports valid rows (201) and reports each as created", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent has ticket:import
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row(), row({ category: "Software", priority: "low" })] });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  it("fails a row with an unknown category, tagging the field", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row({ category: "Nonexistent" })] });
    expect(res.status).toBe(200); // nothing created → 200, not 201
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.results[0]).toMatchObject({
      ok: false,
      field: "category",
    });
  });

  it("fails a row with an unknown requester email, tagging the field", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row({ requesterEmail: "ghost@acme.com" })] });
    expect(res.body.data.results[0]).toMatchObject({
      ok: false,
      field: "requesterEmail",
    });
  });

  it("supports partial success across a mixed batch", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row(), row({ category: "Nonexistent" })] });
    expect(res.status).toBe(201); // at least one created
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.failed).toBe(1);
  });

  it("forbids a requester (no ticket:import) with 403", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(marcus))
      .send({ rows: [row()] });
    expect(res.status).toBe(403);
  });

  it("rejects an empty batch with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [] });
    expect(res.status).toBe(400);
  });
});

describe("integrations — external sources", () => {
  it("lists sources with their implemented/configured status", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/integrations/sources`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const byId: Record<string, { implemented: boolean; configured: boolean }> =
      Object.fromEntries(
        res.body.data.map((s: { id: string }) => [s.id, s]),
      );
    expect(byId.mock).toMatchObject({ implemented: true, configured: true });
    expect(byId.jira.implemented).toBe(false);
  });

  it("syncs the mock source, creating its sample tickets (201)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/integrations/sources/mock/sync`)
      .set(bearer(dana));
    expect(res.status).toBe(201);
    expect(res.body.data.fetched).toBe(3);
    expect(res.body.data.import.created).toBe(3);
  });

  it("501s a source that isn't implemented yet", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/integrations/sources/jira/sync`)
      .set(bearer(dana));
    expect(res.status).toBe(501);
  });

  it("404s an unknown source", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/integrations/sources/nope/sync`)
      .set(bearer(dana));
    expect(res.status).toBe(404);
  });

  it("forbids a requester from running a sync (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/integrations/sources/mock/sync`)
      .set(bearer(marcus));
    expect(res.status).toBe(403);
  });
});

describe("email-to-ticket webhook", () => {
  const ENDPOINT = `${API}/integrations/email-inbound`;
  const SECRET = "test-webhook-secret";

  it("creates a ticket from a known sender (201), sender is the requester", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({
        from: "Marcus Chen <marcus.chen@acme.com>",
        subject: "[high] Cannot connect to VPN",
        text: "It fails right after entering my OTP.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.requesterCreated).toBe(false);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.ticketId },
      include: { requester: true },
    });
    expect(ticket.requester.email).toBe("marcus.chen@acme.com");
    expect(ticket.priority).toBe("high"); // derived from the [high] subject tag
    expect(ticket.subject).toBe("Cannot connect to VPN"); // tag stripped
  });

  it("auto-creates a requester for an unknown sender", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({
        from: "newcomer@partner.example",
        subject: "Need access to the portal",
        text: "Please set me up.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.requesterCreated).toBe(true);

    const user = await prisma.user.findFirstOrThrow({
      where: { email: "newcomer@partner.example" },
    });
    expect(user.role).toBe("requester");
    expect(user.passwordHash).toBeNull();
  });

  it("rejects a wrong secret with 403", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", "wrong-secret")
      .send({ from: "x@acme.com", subject: "hi", text: "y" });
    expect(res.status).toBe(403);
  });

  it("rejects a missing secret with 403", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ from: "x@acme.com", subject: "hi", text: "y" });
    expect(res.status).toBe(403);
  });

  it("rejects a payload with no valid From address (400)", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({ subject: "orphan", text: "no sender" });
    expect(res.status).toBe(400);
  });
});

describe("tickets — agent email reply", () => {
  it("records a public comment and reports the mail transport (201)", async () => {
    const dana = await login("dana.reyes@acme.com"); // assignee of 1042
    const res = await request(app)
      .post(`${API}/tickets/1042/reply`)
      .set(bearer(dana))
      .send({ to: "marcus.chen@acme.com", body: "We're on it — thanks." });
    expect(res.status).toBe(201);
    expect(res.body.data.mail.transport).toBe("log"); // no SMTP configured in tests
    expect(res.body.data.comment.internal).toBe(false);

    // The reply is visible to the requester as a public thread comment.
    const marcus = await login("marcus.chen@acme.com");
    const thread = await request(app)
      .get(`${API}/tickets/1042/comments`)
      .set(bearer(marcus));
    const bodies = thread.body.data.map((c: { body: string }) => c.body);
    expect(bodies).toContain("We're on it — thanks.");
  });

  it("derives the subject from the ticket when none is given", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/1042/reply`)
      .set(bearer(dana))
      .send({ to: "marcus.chen@acme.com", body: "Update inside." });
    expect(res.body.data.mail.subject).toContain("#1042");
  });

  it("forbids a requester from sending a reply (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/1042/reply`)
      .set(bearer(marcus))
      .send({ to: "someone@acme.com", body: "hi" });
    expect(res.status).toBe(403);
  });

  it("404s a reply on an out-of-scope ticket", async () => {
    const dana = await login("dana.reyes@acme.com"); // 1029 is Field Services
    const res = await request(app)
      .post(`${API}/tickets/1029/reply`)
      .set(bearer(dana))
      .send({ to: "x@acme.com", body: "hi" });
    expect(res.status).toBe(404);
  });

  it("rejects a non-email 'to' with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/1042/reply`)
      .set(bearer(dana))
      .send({ to: "not-an-email", body: "hi" });
    expect(res.status).toBe(400);
  });
});

describe("attachments — delete", () => {
  it("deletes an uploaded attachment (204); afterwards it is gone", async () => {
    const dana = await login("dana.reyes@acme.com");
    const up = await request(app)
      .post(`${API}/tickets/1042/attachments`)
      .set(bearer(dana))
      .attach("file", Buffer.from("bye"), {
        filename: "temp.txt",
        contentType: "text/plain",
      });
    expect(up.status).toBe(201);
    const id = up.body.data.id as number;

    await request(app)
      .delete(`${API}/attachments/${id}`)
      .set(bearer(dana))
      .expect(204);

    // The row is gone: download 404s and the list is empty.
    await request(app).get(`${API}/attachments/${id}`).set(bearer(dana)).expect(404);
    const list = await request(app)
      .get(`${API}/tickets/1042/attachments`)
      .set(bearer(dana));
    expect(list.body.data).toHaveLength(0);
  });

  it("downloads 404 on an orphaned row (DB row present, bytes missing), and delete still succeeds", async () => {
    const dana = await login("dana.reyes@acme.com");
    const uploader = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    // A DB row pointing at a storage key that was never written.
    const orphan = await prisma.attachment.create({
      data: {
        ticketId: 1042,
        uploaderId: uploader.id,
        filename: "gone.txt",
        contentType: "text/plain",
        sizeBytes: 3,
        storageKey: "tickets/1042/does-not-exist.txt",
      },
    });

    // Download → clean 404 (not a 500 crash).
    await request(app)
      .get(`${API}/attachments/${orphan.id}`)
      .set(bearer(dana))
      .expect(404);

    // Delete is best-effort about the missing file → still 204 and delists.
    await request(app)
      .delete(`${API}/attachments/${orphan.id}`)
      .set(bearer(dana))
      .expect(204);
    expect(
      await prisma.attachment.findUnique({ where: { id: orphan.id } }),
    ).toBeNull();
  });

  it("forbids a requester (no ticket:write) from deleting (403)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const up = await request(app)
      .post(`${API}/tickets/1042/attachments`)
      .set(bearer(dana))
      .attach("file", Buffer.from("x"), {
        filename: "keep.txt",
        contentType: "text/plain",
      });
    const marcus = await login("marcus.chen@acme.com");
    await request(app)
      .delete(`${API}/attachments/${up.body.data.id}`)
      .set(bearer(marcus))
      .expect(403);
  });
});

describe("comments — SSE stream (real-time)", () => {
  // SSE keeps the connection open, so supertest (which buffers until the
  // response ends) can't read it. Run the app on a real socket and read frames
  // off the stream directly. The event bus is an in-process singleton, so a
  // comment created via supertest fans out to a listener opened on this server.
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    server.close();
  });

  /**
   * Open an SSE connection; once the `: connected` preamble arrives, run
   * `action` (which should create comments), then collect frames for a short
   * window and close. Returns the non-empty frames received.
   */
  function collect(
    path: string,
    token: string,
    action: () => Promise<void>,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `${baseUrl}${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          let buf = "";
          let acted = false;
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            buf += chunk;
            if (!acted && buf.includes(": connected")) {
              acted = true;
              action()
                .catch(reject)
                .finally(() => {
                  setTimeout(() => {
                    req.destroy();
                    resolve(buf.split("\n\n").filter((f) => f.trim().length));
                  }, 300);
                });
            }
          });
        },
      );
      req.on("error", reject);
    });
  }

  it("rejects a stream on an out-of-scope ticket with 404 (before opening)", async () => {
    const marcus = await login("marcus.chen@acme.com"); // not on ticket 1039
    await request(app)
      .get(`${API}/tickets/1039/comments/stream`)
      .set(bearer(marcus))
      .expect(404);
  });

  it("delivers a comment.created frame to a subscriber", async () => {
    const dana = await login("dana.reyes@acme.com");
    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      dana,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments`)
          .set(bearer(dana))
          .send({ body: "streamed hello" })
          .expect(201);
      },
    );
    const event = frames.find((f) => f.startsWith("event: comment.created"));
    expect(event).toBeDefined();
    expect(event).toContain("streamed hello");
  });

  it("withholds internal notes from a requester but forwards public replies", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent (write-capable)
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      marcus, // canInternal = false
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments`)
          .set(bearer(dana))
          .send({ body: "secret internal", internal: true })
          .expect(201);
        await request(app)
          .post(`${API}/tickets/1042/comments`)
          .set(bearer(dana))
          .send({ body: "public visible" })
          .expect(201);
      },
    );
    const joined = frames.join("\n");
    expect(joined).toContain("public visible");
    expect(joined).not.toContain("secret internal");
  });

  it("delivers a typing signal to another subscriber (named)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      marcus,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments/typing`)
          .set(bearer(dana))
          .expect(204);
      },
    );
    const typing = frames.find((f) => f.startsWith("event: typing"));
    expect(typing).toBeDefined();
    expect(typing).toContain("Dana Reyes");
  });

  it("does not echo a user's own typing back to them", async () => {
    const dana = await login("dana.reyes@acme.com");
    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      dana,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments/typing`)
          .set(bearer(dana))
          .expect(204);
      },
    );
    expect(frames.some((f) => f.startsWith("event: typing"))).toBe(false);
  });

  it("404s a typing signal on an out-of-scope ticket", async () => {
    const marcus = await login("marcus.chen@acme.com"); // not on 1039
    await request(app)
      .post(`${API}/tickets/1039/comments/typing`)
      .set(bearer(marcus))
      .expect(404);
  });

  it("delivers a read receipt to another subscriber (the message author)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const posted = await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "did you see this?" })
      .expect(201);
    const commentId = posted.body.data.id as number;

    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      dana,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments/read`)
          .set(bearer(marcus))
          .send({ lastReadId: commentId })
          .expect(200);
      },
    );
    const read = frames.find((f) => f.startsWith("event: read"));
    expect(read).toBeDefined();
    expect(read).toContain(String(commentId));
  });

  it("does not echo a user's own read receipt back to them", async () => {
    const dana = await login("dana.reyes@acme.com");
    const posted = await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "self read" })
      .expect(201);
    const commentId = posted.body.data.id as number;
    const frames = await collect(
      `${API}/tickets/1042/comments/stream`,
      dana,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments/read`)
          .set(bearer(dana))
          .send({ lastReadId: commentId })
          .expect(200);
      },
    );
    expect(frames.some((f) => f.startsWith("event: read"))).toBe(false);
  });
});

describe("comments — read receipts", () => {
  async function userId(email: string): Promise<number> {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    return u.id;
  }

  it("records a read pointer and reports it in reads", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");
    const marcusId = await userId("marcus.chen@acme.com");
    const posted = await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "please read" })
      .expect(201);
    const commentId = posted.body.data.id as number;

    const marked = await request(app)
      .post(`${API}/tickets/1042/comments/read`)
      .set(bearer(marcus))
      .send({ lastReadId: commentId });
    expect(marked.status).toBe(200);
    expect(marked.body.data.lastReadId).toBe(commentId);

    const reads = await request(app)
      .get(`${API}/tickets/1042/comments/reads`)
      .set(bearer(dana));
    expect(reads.status).toBe(200);
    const marker = reads.body.data.find(
      (r: { userId: number }) => r.userId === marcusId,
    );
    expect(marker.lastReadCommentId).toBe(commentId);
  });

  it("only advances the read pointer forward", async () => {
    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");
    const marcusId = await userId("marcus.chen@acme.com");
    const c1 = (
      await request(app)
        .post(`${API}/tickets/1042/comments`)
        .set(bearer(dana))
        .send({ body: "first" })
        .expect(201)
    ).body.data.id as number;
    const c2 = (
      await request(app)
        .post(`${API}/tickets/1042/comments`)
        .set(bearer(dana))
        .send({ body: "second" })
        .expect(201)
    ).body.data.id as number;

    await request(app)
      .post(`${API}/tickets/1042/comments/read`)
      .set(bearer(marcus))
      .send({ lastReadId: c2 })
      .expect(200);
    // Marking an older comment must not move the pointer backwards.
    const back = await request(app)
      .post(`${API}/tickets/1042/comments/read`)
      .set(bearer(marcus))
      .send({ lastReadId: c1 })
      .expect(200);
    expect(back.body.data.lastReadId).toBe(c2);

    const reads = await request(app)
      .get(`${API}/tickets/1042/comments/reads`)
      .set(bearer(dana));
    const m = reads.body.data.find(
      (r: { userId: number }) => r.userId === marcusId,
    );
    expect(m.lastReadCommentId).toBe(c2);
  });

  it("404s read + reads on an out-of-scope ticket", async () => {
    const marcus = await login("marcus.chen@acme.com"); // not on 1039
    await request(app)
      .post(`${API}/tickets/1039/comments/read`)
      .set(bearer(marcus))
      .send({ lastReadId: 1 })
      .expect(404);
    await request(app)
      .get(`${API}/tickets/1039/comments/reads`)
      .set(bearer(marcus))
      .expect(404);
  });
});
