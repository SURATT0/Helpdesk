import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
