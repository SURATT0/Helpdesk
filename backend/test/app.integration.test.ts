import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { ticketService } from "../src/modules/tickets/ticket.service";
import { notificationService } from "../src/modules/notifications/notification.service";
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

describe("tickets — RBAC row scoping (multi-tenant)", () => {
  it("scopes an agent to their own customer, across departments", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent, Acme Corp
    const res = await request(app).get(`${API}/tickets`).set(bearer(dana));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toContain(1042); // Acme, own team
    expect(ids).toContain(1029); // Acme, another team — visible (same customer)
    expect(ids).not.toContain(2001); // Globex — other customer, hidden
  });

  it("scopes a requester to only their own tickets", async () => {
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const res = await request(app).get(`${API}/tickets`).set(bearer(marcus));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toEqual([1042]);
  });

  it("lets a platform admin see every customer's tickets", async () => {
    const sam = await login("sam.rivera@acme.com"); // admin, no customer
    const res = await request(app).get(`${API}/tickets`).set(bearer(sam));
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toContain(1042); // Acme
    expect(ids).toContain(2001); // Globex
  });

  it("404s an out-of-scope ticket instead of leaking it", async () => {
    // A fellow Acme user's ticket (not their own) → 404 for a requester.
    const marcus = await login("marcus.chen@acme.com");
    await request(app).get(`${API}/tickets/1039`).set(bearer(marcus)).expect(404);
    // Another customer's ticket → 404 for an Acme agent.
    const dana = await login("dana.reyes@acme.com");
    await request(app).get(`${API}/tickets/2001`).set(bearer(dana)).expect(404);
  });
});

describe("tickets — closed history log", () => {
  /**
   * The seed closes nothing (1031 ships as `resolved`), so each case arranges
   * its own closures. Timestamps are built with the LOCAL date constructor
   * because period bounds are server-local by design — UTC literals would make
   * these assertions pass only in UTC.
   */
  const now = new Date();
  const inThisMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12);
  const inLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);

  const close = (id: number, closedAt: Date) =>
    prisma.ticket.update({
      where: { id },
      data: { status: "closed", closedAt },
    });

  const idsOf = (res: { body: { data: { id: number }[] } }) =>
    res.body.data.map((t) => t.id);

  const get = (token: string, qs = "") =>
    request(app).get(`${API}/tickets/closed${qs}`).set(bearer(token));

  it("returns tickets closed in the current period and excludes older ones", async () => {
    await close(1031, inThisMonth);
    await close(1029, inLastMonth);

    const dana = await login("dana.reyes@acme.com");
    const res = await get(dana, "?granularity=month");
    expect(res.status).toBe(200);
    expect(idsOf(res)).toContain(1031);
    expect(idsOf(res)).not.toContain(1029);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.period.granularity).toBe("month");
    expect(res.body.meta.period.isCurrent).toBe(true);
  });

  it("steps to the previous period with the anchor it was handed", async () => {
    await close(1031, inThisMonth);
    await close(1029, inLastMonth);

    const dana = await login("dana.reyes@acme.com");
    const current = await get(dana, "?granularity=month");
    const older = await get(
      dana,
      `?granularity=month&anchor=${current.body.meta.period.prevAnchor}`,
    );

    expect(older.status).toBe(200);
    expect(idsOf(older)).toContain(1029);
    expect(idsOf(older)).not.toContain(1031);
    expect(older.body.meta.period.isCurrent).toBe(false);
  });

  it("widens to the year, holding both months", async () => {
    await close(1031, inThisMonth);
    await close(1029, inLastMonth);

    const dana = await login("dana.reyes@acme.com");
    const res = await get(dana, "?granularity=year");
    // Guard: in January the previous month falls in the previous YEAR, so only
    // assert the pair together when both sit inside one calendar year.
    if (inLastMonth.getFullYear() === inThisMonth.getFullYear()) {
      expect(idsOf(res)).toEqual(expect.arrayContaining([1031, 1029]));
    } else {
      expect(idsOf(res)).toContain(1031);
      expect(idsOf(res)).not.toContain(1029);
    }
  });

  it("excludes a reopened ticket that still carries its old closedAt", async () => {
    // `closedAt` is never cleared — the 30-day reopen check reads it back — so
    // the status is what keeps a reopened ticket out of the log.
    await close(1031, inThisMonth);
    await prisma.ticket.update({ where: { id: 1031 }, data: { status: "open" } });

    const dana = await login("dana.reyes@acme.com");
    const res = await get(dana, "?granularity=month");
    expect(idsOf(res)).not.toContain(1031);
  });

  it("scopes the log per role, exactly like the live ticket list", async () => {
    await close(1031, inThisMonth); // Acme, requested by A. Lindqvist
    await close(2001, inThisMonth); // Globex — another customer

    const dana = await login("dana.reyes@acme.com"); // agent, Acme
    const asAgent = idsOf(await get(dana, "?granularity=month"));
    expect(asAgent).toContain(1031);
    expect(asAgent).not.toContain(2001); // other customer, hidden

    const lindqvist = await login("a.lindqvist@acme.com"); // requester, owns 1031
    const asOwner = idsOf(await get(lindqvist, "?granularity=month"));
    expect(asOwner).toContain(1031);
    expect(asOwner).not.toContain(2001);

    // Marcus is deliberately absent from the seeded closure history, so his log
    // is genuinely empty rather than merely missing 1031.
    const marcus = await login("marcus.chen@acme.com"); // requester, owns neither
    expect(idsOf(await get(marcus, "?granularity=month"))).toEqual([]);

    const sam = await login("sam.rivera@acme.com"); // platform admin
    expect(idsOf(await get(sam, "?granularity=month"))).toEqual(
      expect.arrayContaining([1031, 2001]),
    );
  });

  it("paginates within the period", async () => {
    await close(1031, inThisMonth);
    await close(1029, inThisMonth);

    const dana = await login("dana.reyes@acme.com");
    const page = await get(dana, "?granularity=month&limit=1&offset=0");
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(page.body.meta.returned).toBe(1);

    const next = await get(dana, "?granularity=month&limit=1&offset=1");
    expect(idsOf(next)).not.toEqual(idsOf(page));
  });

  it("rejects an unknown granularity with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    await get(dana, "?granularity=decade").expect(400);
  });

  it("requires authentication", async () => {
    await request(app).get(`${API}/tickets/closed`).expect(401);
  });

  it("does not shadow the /tickets/:id route", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app).get(`${API}/tickets/1042`).set(bearer(dana)).expect(200);
  });
});

describe("tickets — closed history period picker", () => {
  const periods = (token: string, qs = "") =>
    request(app)
      .get(`${API}/tickets/closed/periods${qs}`)
      .set(bearer(token));

  const yearsOf = (res: { body: { data: { start: string }[] } }) =>
    res.body.data.map((p) => new Date(p.start).getFullYear());

  it("lists only populated periods, newest first, with counts", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await periods(dana, "?granularity=year");
    expect(res.status).toBe(200);

    // The seed spans several calendar years, so there is more than one to offer —
    // which is the whole point of the picker.
    expect(res.body.data.length).toBeGreaterThan(1);
    for (const p of res.body.data) expect(p.count).toBeGreaterThan(0);

    // Newest first.
    const starts = res.body.data.map((p: { start: string }) =>
      Date.parse(p.start),
    );
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });

  it("counts agree with the rows the log returns for the same window", async () => {
    const dana = await login("dana.reyes@acme.com");
    const list = await periods(dana, "?granularity=year");
    const newest = list.body.data[0];

    const page = await request(app)
      .get(
        `${API}/tickets/closed?granularity=year&anchor=${newest.start}&limit=200`,
      )
      .set(bearer(dana));
    expect(page.status).toBe(200);
    // The picker's count and the log's total are the same question asked twice;
    // they share resolvePeriod, so a boundary bug would show up as a mismatch.
    expect(page.body.meta.total).toBe(newest.count);
  });

  it("offers a period whose anchor lands on that exact window", async () => {
    const dana = await login("dana.reyes@acme.com");
    const list = await periods(dana, "?granularity=year");
    // Pick a past year, so this also proves the anchor is not just "now".
    const past = list.body.data[1];

    const page = await request(app)
      .get(`${API}/tickets/closed?granularity=year&anchor=${past.start}`)
      .set(bearer(dana));
    expect(page.body.meta.period.start).toBe(past.start);
    expect(page.body.meta.period.end).toBe(past.end);
    expect(page.body.meta.period.isCurrent).toBe(false);
  });

  it("buckets by month as well as by year", async () => {
    const dana = await login("dana.reyes@acme.com");
    const byMonth = await periods(dana, "?granularity=month");
    const byYear = await periods(dana, "?granularity=year");
    // Months are finer, so there are at least as many of them.
    expect(byMonth.body.data.length).toBeGreaterThanOrEqual(
      byYear.body.data.length,
    );
    expect(byMonth.body.meta.granularity).toBe("month");
  });

  it("is row-scoped: the picker never reveals another customer's history", async () => {
    const dana = await login("dana.reyes@acme.com"); // agent, Acme
    const sam = await login("sam.rivera@acme.com"); // platform admin

    const agentTotal = (await periods(dana, "?granularity=year")).body.data
      .reduce((n: number, p: { count: number }) => n + p.count, 0);
    const adminTotal = (await periods(sam, "?granularity=year")).body.data
      .reduce((n: number, p: { count: number }) => n + p.count, 0);

    // The seed closes at least one Globex ticket, which the Acme agent cannot see,
    // so the admin's counts must strictly exceed theirs.
    expect(adminTotal).toBeGreaterThan(agentTotal);
  });

  it("returns an empty list for a requester with no closed tickets", async () => {
    // Marcus is deliberately absent from the seeded closure history.
    const marcus = await login("marcus.chen@acme.com");
    const res = await periods(marcus, "?granularity=year");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(yearsOf(res)).toEqual([]);
  });

  it("reports the cap rather than silently clipping", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await periods(dana, "?granularity=year");
    expect(res.body.meta.limit).toBeGreaterThan(0);
    // The seed is far short of the cap, so nothing should be clipped here — the
    // flag exists so a long archive cannot read as complete.
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.returned).toBe(res.body.data.length);
  });

  it("rejects an unknown granularity with 400", async () => {
    const dana = await login("dana.reyes@acme.com");
    await periods(dana, "?granularity=decade").expect(400);
  });

  it("requires authentication", async () => {
    await request(app).get(`${API}/tickets/closed/periods`).expect(401);
  });
});

describe("tickets — assignee identity and filter", () => {
  it("exposes assigneeId alongside the display name", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app).get(`${API}/tickets/1042`).set(bearer(dana));
    expect(res.status).toBe(200);

    const danaRow = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    expect(res.body.data.assignee).toBe("Dana Reyes");
    // The client filters and groups on the id, since names are not unique.
    expect(res.body.data.assigneeId).toBe(danaRow.id);
  });

  it("reports assigneeId as null for an unassigned ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app).get(`${API}/tickets/1044`).set(bearer(dana));
    expect(res.status).toBe(200);
    expect(res.body.data.assignee).toBeNull();
    expect(res.body.data.assigneeId).toBeNull();
  });

  it("filters the list to one agent's queue", async () => {
    const dana = await login("dana.reyes@acme.com");
    const danaRow = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=${danaRow.id}`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain(1042); // Dana's
    expect(ids).not.toContain(1029); // Kai's
    for (const row of res.body.data as Array<{ assigneeId: number }>) {
      expect(row.assigneeId).toBe(danaRow.id);
    }
  });

  it("filters the list to the unassigned queue", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=none`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const ids: number[] = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toContain(1044); // Acme, unassigned
    for (const row of res.body.data as Array<{ assigneeId: number | null }>) {
      expect(row.assigneeId).toBeNull();
    }
  });

  // The assignee filter is AND-ed with row scope, never a way around it.
  it("cannot reach another customer's tickets through the filter", async () => {
    const dana = await login("dana.reyes@acme.com"); // Acme
    const owen = await prisma.user.findUniqueOrThrow({
      where: { email: "owen.park@acme.com" }, // Globex agent
    });
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=${owen.id}`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
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

  it("404s a status change on another customer's ticket", async () => {
    const dana = await login("dana.reyes@acme.com"); // Acme
    const res = await request(app)
      .patch(`${API}/tickets/2002/status`) // Globex ticket
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

describe("tickets — SLA alert sweep", () => {
  const HOUR = 60 * 60 * 1000;
  const now = new Date();
  const inHours = (h: number) => new Date(now.getTime() + h * HOUR);

  /** Park every seeded ticket's clock far in the future so tests start quiet. */
  async function quietAllClocks() {
    await prisma.ticket.updateMany({ data: { dueAt: inHours(500) } });
  }

  const slaNotifications = (ticketId: number) =>
    prisma.notification.findMany({
      where: {
        ticketId,
        type: { in: ["ticket.sla_warning", "ticket.sla_breach"] },
      },
      orderBy: { id: "asc" },
    });

  beforeEach(quietAllClocks);

  it("warns the assignee when the clock enters the warn window", async () => {
    // 1042: Acme, in_progress, assigned to Dana.
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(2) },
    });

    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.warned).toBe(1);
    expect(res.breached).toBe(0);

    const notes = await slaNotifications(1042);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("ticket.sla_warning");
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    expect(notes[0].userId).toBe(dana.id);
    expect(notes[0].message).toContain("#1042");
  });

  it("reports a breach once the clock is past due", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(-1) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.breached).toBe(1);
    const notes = await slaNotifications(1042);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("ticket.sla_breach");
  });

  // The sweep runs every 15 minutes over the same at-risk rows.
  it("is idempotent across runs", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(2) },
    });
    const first = await ticketService.sweepSlaAlerts(now);
    expect(first.warned).toBe(1);

    const second = await ticketService.sweepSlaAlerts(new Date(now.getTime() + 60_000));
    expect(second.warned).toBe(0);
    expect(await slaNotifications(1042)).toHaveLength(1);
  });

  // Being warned must not swallow the breach that follows.
  it("still raises a breach after having warned", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(1) },
    });
    await ticketService.sweepSlaAlerts(now);

    // Time passes; the same ticket is now overdue.
    const later = new Date(now.getTime() + 2 * HOUR);
    const res = await ticketService.sweepSlaAlerts(later);
    expect(res.breached).toBe(1);

    const notes = await slaNotifications(1042);
    expect(notes.map((n) => n.type)).toEqual([
      "ticket.sla_warning",
      "ticket.sla_breach",
    ]);
  });

  it("ignores a paused (pending) ticket — the clock is stopped", async () => {
    // 1039 is seeded pending.
    await prisma.ticket.update({
      where: { id: 1039 },
      data: { dueAt: inHours(-5) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.warned + res.breached).toBe(0);
    expect(await slaNotifications(1039)).toHaveLength(0);
  });

  it("ignores resolved and closed tickets", async () => {
    await prisma.ticket.update({
      where: { id: 1031 }, // seeded resolved
      data: { dueAt: inHours(-5) },
    });
    await prisma.ticket.update({
      where: { id: 1035 },
      data: { status: "closed", closedAt: now, dueAt: inHours(-5) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.warned + res.breached).toBe(0);
  });

  // An unassigned ticket is exactly where a breach goes unnoticed, so it falls
  // to that customer's managers rather than nobody.
  it("falls back to the customer's managers when unassigned", async () => {
    await prisma.ticket.update({
      where: { id: 1044 }, // Acme, new, assignee null
      data: { dueAt: inHours(-1) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.breached).toBe(1);

    const notes = await slaNotifications(1044);
    const morgan = await prisma.user.findUniqueOrThrow({
      where: { email: "morgan.lee@acme.com" }, // Acme manager
    });
    expect(notes.map((n) => n.userId)).toContain(morgan.id);

    // Not the other customer's manager, and not the requester.
    const nadia = await prisma.user.findUniqueOrThrow({
      where: { email: "nadia.kofi@acme.com" }, // Globex manager
    });
    expect(notes.map((n) => n.userId)).not.toContain(nadia.id);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: 1044 } });
    expect(notes.map((n) => n.userId)).not.toContain(t.requesterId);
  });

  it("counts tickets, not notification rows, when several managers are told", async () => {
    await prisma.ticket.update({
      where: { id: 1044 },
      data: { dueAt: inHours(-1) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    // One ticket breached, however many managers received a row for it.
    expect(res.breached).toBe(1);
    expect((await slaNotifications(1044)).length).toBeGreaterThanOrEqual(1);
  });

  it("never notifies the requester", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(-1) },
    });
    await ticketService.sweepSlaAlerts(now);
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" }, // requester of 1042
    });
    const notes = await slaNotifications(1042);
    expect(notes.map((n) => n.userId)).not.toContain(marcus.id);
  });

  it("notifies the new assignee after a reassignment", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(2) },
    });
    await ticketService.sweepSlaAlerts(now);

    const ana = await prisma.user.findUniqueOrThrow({
      where: { email: "ana.m@acme.com" },
    });
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { assigneeId: ana.id },
    });

    const res = await ticketService.sweepSlaAlerts(new Date(now.getTime() + 60_000));
    expect(res.warned).toBe(1);
    const notes = await slaNotifications(1042);
    expect(notes.map((n) => n.userId)).toContain(ana.id);
  });

  it("does nothing when every clock is comfortable", async () => {
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res).toEqual({ warned: 0, breached: 0 });
  });

  it("surfaces the alert on the recipient's notification feed", async () => {
    await prisma.ticket.update({
      where: { id: 1042 },
      data: { dueAt: inHours(-1) },
    });
    await ticketService.sweepSlaAlerts(now);

    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/notifications`)
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const types: string[] = res.body.data.map((n: { type: string }) => n.type);
    expect(types).toContain("ticket.sla_breach");
    expect(res.body.meta.unread).toBeGreaterThanOrEqual(1);
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

describe("tickets — customer isolation (unassigned ticket)", () => {
  it("shows an unassigned ticket to any agent in its customer, but not to other customers", async () => {
    const category = await prisma.category.create({
      data: { name: "Uncategorized", defaultTeamId: null },
    });
    const acme = await prisma.customer.findUniqueOrThrow({
      where: { name: "Acme Corp" },
    });
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: "t.alvarez@acme.com" }, // Acme requester
    });
    const orphan = await prisma.ticket.create({
      data: {
        subject: "Orphan ticket in a team-less category",
        description: "no category routing",
        status: "new",
        priority: "medium",
        requesterId: requester.id,
        categoryId: category.id,
        customerId: acme.id,
        dueAt: new Date(Date.now() + 3_600_000),
      },
    });

    const idsFor = async (token: string) => {
      const res = await request(app).get(`${API}/tickets`).set(bearer(token));
      return (res.body.data as { id: number }[]).map((t) => t.id);
    };

    const dana = await login("dana.reyes@acme.com"); // Acme agent
    const kai = await login("kai.t@acme.com"); // Acme agent (another team)
    const owen = await login("owen.park@acme.com"); // Globex agent
    const marcus = await login("marcus.chen@acme.com"); // Acme requester (not this ticket)

    expect(await idsFor(dana)).toContain(orphan.id); // same customer
    expect(await idsFor(kai)).toContain(orphan.id); // same customer, other team
    expect(await idsFor(owen)).not.toContain(orphan.id); // other customer
    expect(await idsFor(marcus)).not.toContain(orphan.id); // not the requester
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

describe("users — customer-scoped management (manager)", () => {
  async function userId(email: string): Promise<number> {
    return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  it("scopes a manager's directory to their own customer", async () => {
    const morgan = await login("morgan.lee@acme.com"); // manager, Acme
    const res = await request(app).get(`${API}/users`).set(bearer(morgan));
    expect(res.status).toBe(200);
    const names: string[] = res.body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Dana Reyes"); // Acme
    expect(names).not.toContain("Owen Park"); // Globex — other customer
  });

  it("lets a manager edit a user in their customer", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const kaiId = await userId("kai.t@acme.com"); // Acme
    const res = await request(app)
      .patch(`${API}/users/${kaiId}`)
      .set(bearer(morgan))
      .send({ role: "agent" });
    expect(res.status).toBe(200);
  });

  it("404s a manager editing a user in another customer", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const owenId = await userId("owen.park@acme.com"); // Globex
    await request(app)
      .patch(`${API}/users/${owenId}`)
      .set(bearer(morgan))
      .send({ role: "agent" })
      .expect(404);
  });

  it("forbids a manager from granting the admin role", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const kaiId = await userId("kai.t@acme.com");
    await request(app)
      .patch(`${API}/users/${kaiId}`)
      .set(bearer(morgan))
      .send({ role: "admin" })
      .expect(403);
  });

  it("lets an admin see + manage users across customers", async () => {
    const sam = await login("sam.rivera@acme.com"); // admin, no customer
    const list = await request(app).get(`${API}/users`).set(bearer(sam));
    const names: string[] = list.body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Dana Reyes"); // Acme
    expect(names).toContain("Owen Park"); // Globex — other customer
    const owenId = await userId("owen.park@acme.com");
    await request(app)
      .patch(`${API}/users/${owenId}`)
      .set(bearer(sam))
      .send({ role: "agent" })
      .expect(200);
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

  // The reason EMAIL_DEFAULT_CUSTOMER exists. A requester created with
  // customerId null produces a ticket with customerId null, and
  // ticketScopeWhere matches staff on customerId EQUALITY — so that ticket is
  // invisible to every agent and manager. Silently filing an unseeable ticket is
  // worse than refusing the mail.
  it("files an unknown sender under the configured tenant", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({
        from: "stranger@partner.example",
        subject: "Cannot reach the portal",
        text: "It times out.",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.requesterCreated).toBe(true);

    const acme = await prisma.customer.findUniqueOrThrow({
      where: { name: "Acme Corp" },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { email: "stranger@partner.example" },
    });
    expect(user.customerId).toBe(acme.id);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.ticketId },
    });
    expect(ticket.customerId).toBe(acme.id);
  });

  // The consequence that actually matters: staff can see it.
  it("makes that ticket visible to an agent of the tenant", async () => {
    const created = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({
        from: "stranger2@partner.example",
        subject: "Printer offline",
        text: "Nothing prints.",
      });
    expect(created.status).toBe(201);

    const dana = await login("dana.reyes@acme.com"); // Acme agent
    const list = await request(app).get(`${API}/tickets`).set(bearer(dana));
    const ids: number[] = list.body.data.map((t: { id: number }) => t.id);
    expect(ids).toContain(created.body.data.ticketId);
  });

  it("refuses an unknown sender when no tenant is configured (400)", async () => {
    // env is read once at import; this property is what the service consults, so
    // override it for the duration of the check and put it back.
    const original = env.integrations.email.defaultCustomer;
    env.integrations.email.defaultCustomer = undefined;
    try {
      const res = await request(app)
        .post(ENDPOINT)
        .set("x-webhook-secret", SECRET)
        .send({
          from: "nowhere@partner.example",
          subject: "No tenant",
          text: "x",
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/EMAIL_DEFAULT_CUSTOMER/);
      // Nothing was created — not a half-written user with no tenant.
      expect(
        await prisma.user.count({ where: { email: "nowhere@partner.example" } }),
      ).toBe(0);
    } finally {
      env.integrations.email.defaultCustomer = original;
    }
  });

  it("refuses when the configured tenant does not exist (400)", async () => {
    const original = env.integrations.email.defaultCustomer;
    env.integrations.email.defaultCustomer = "No Such Customer Ltd";
    try {
      const res = await request(app)
        .post(ENDPOINT)
        .set("x-webhook-secret", SECRET)
        .send({
          from: "ghost@partner.example",
          subject: "Bad tenant",
          text: "x",
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/No Such Customer Ltd/);
    } finally {
      env.integrations.email.defaultCustomer = original;
    }
  });

  it("leaves a known sender's own tenant alone", async () => {
    // Marcus is Acme; the default customer must not override a real membership.
    const res = await request(app)
      .post(ENDPOINT)
      .set("x-webhook-secret", SECRET)
      .send({
        from: "marcus.chen@acme.com",
        subject: "Known sender",
        text: "x",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.requesterCreated).toBe(false);
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    expect(res.body.data.requesterId).toBe(marcus.id);
  });
});

// The other half of this branch: a mailed reply carrying [#123] joins that
// ticket's thread instead of opening a duplicate ticket. Ticket 1042 is Acme,
// requester Marcus Chen, assignee Dana Reyes.
describe("email-to-ticket threading", () => {
  const ENDPOINT = `${API}/integrations/email-inbound`;
  const SECRET = "test-webhook-secret";

  const post = (body: Record<string, unknown>) =>
    request(app).post(ENDPOINT).set("x-webhook-secret", SECRET).send(body);

  const commentsOn = (ticketId: number) =>
    prisma.comment.findMany({ where: { ticketId }, orderBy: { id: "asc" } });

  it("threads the requester's reply onto the referenced ticket", async () => {
    const before = await commentsOn(1042);
    const res = await post({
      from: "marcus.chen@acme.com",
      subject: "Re: [#1042] VPN drops every 10 minutes after 4.2 update",
      text: "Still happening this morning.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("comment");
    expect(res.body.data.ticketId).toBe(1042);

    const after = await commentsOn(1042);
    expect(after.length).toBe(before.length + 1);
    const added = after[after.length - 1];
    expect(added.body).toBe("Still happening this morning.");
    expect(added.channel).toBe("email");
    expect(added.internal).toBe(false);
  });

  it("lets the assigned agent thread a reply in", async () => {
    const res = await post({
      from: "dana.reyes@acme.com",
      subject: "Re: [#1042] VPN drops every 10 minutes after 4.2 update",
      text: "Escalating to Network Ops.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("comment");
  });

  // The security case: a subject line is sender-controlled, so guessing an id
  // must not reach someone else's conversation.
  it("opens a new ticket instead of threading for an unrelated requester", async () => {
    const before = await commentsOn(1042);
    const res = await post({
      from: "t.alvarez@acme.com", // Acme requester, nothing to do with 1042
      subject: "Re: [#1042] VPN drops every 10 minutes after 4.2 update",
      text: "Let me in.",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("ticket");
    expect(res.body.data.ticketId).not.toBe(1042);
    expect(await commentsOn(1042)).toHaveLength(before.length);

    // The quoted ref is stripped so the new ticket's title isn't misleading.
    const created = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.ticketId },
    });
    expect(created.subject).not.toContain("#1042");
  });

  it("does not let another customer's user thread onto an Acme ticket", async () => {
    const before = await commentsOn(1042);
    const res = await post({
      from: "priya.shah@acme.com", // seeded address, but a Globex user
      subject: "[#1042] give me the details",
      text: "hello",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("ticket");
    expect(await commentsOn(1042)).toHaveLength(before.length);
  });

  it("ignores a redelivered message instead of double-posting", async () => {
    const payload = {
      from: "marcus.chen@acme.com",
      subject: "Re: [#1042] VPN drops every 10 minutes after 4.2 update",
      "message-id": "<dup-1@mail.test>",
      text: "Sending again in case you missed it.",
    };

    const first = await post(payload);
    expect(first.status).toBe(201);
    expect(first.body.data.kind).toBe("comment");
    const afterFirst = await commentsOn(1042);

    const second = await post(payload);
    // 200, not 201 — nothing was created the second time.
    expect(second.status).toBe(200);
    expect(second.body.data.kind).toBe("duplicate");
    expect(second.body.data.commentId).toBe(first.body.data.commentId);
    expect(await commentsOn(1042)).toHaveLength(afterFirst.length);
  });

  it("shows a threaded email reply to the requester in the ticket thread", async () => {
    await post({
      from: "marcus.chen@acme.com",
      subject: "Re: [#1042] VPN drops every 10 minutes after 4.2 update",
      text: "Adding a screenshot next time.",
    });

    const marcus = await login("marcus.chen@acme.com");
    const thread = await request(app)
      .get(`${API}/tickets/1042/comments`)
      .set(bearer(marcus));
    expect(thread.status).toBe(200);
    const bodies: string[] = thread.body.data.map(
      (c: { body: string }) => c.body,
    );
    expect(bodies).toContain("Adding a screenshot next time.");
  });

  it("opens a new ticket when the referenced id does not exist", async () => {
    const res = await post({
      from: "marcus.chen@acme.com",
      subject: "Re: [#999999] something that was never real",
      text: "x",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("ticket");
  });

  // A custom subject used to go out without the tag, which made its reply
  // unthreadable. ensureTicketRef stamps it either way.
  it("keeps a custom reply subject threadable end to end", async () => {
    const dana = await login("dana.reyes@acme.com");
    const sent = await request(app)
      .post(`${API}/tickets/1042/reply`)
      .set(bearer(dana))
      .send({
        to: "marcus.chen@acme.com",
        subject: "About your VPN problem",
        body: "Can you retry?",
      });
    expect(sent.status).toBe(201);
    expect(sent.body.data.mail.subject).toBe("[#1042] About your VPN problem");

    // The requester replies to exactly what they received.
    const back = await post({
      from: "marcus.chen@acme.com",
      subject: `Re: ${sent.body.data.mail.subject}`,
      text: "Retried, no luck.",
    });
    expect(back.body.data.kind).toBe("comment");
    expect(back.body.data.ticketId).toBe(1042);
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

  it("404s a reply on another customer's ticket", async () => {
    const dana = await login("dana.reyes@acme.com"); // Acme; 2001 is Globex
    const res = await request(app)
      .post(`${API}/tickets/2001/reply`)
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

  it("pings the recipient's notification stream when they get a notification", async () => {
    const dana = await login("dana.reyes@acme.com"); // assignee of 1042
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    const frames = await collect(
      `${API}/notifications/stream`,
      marcus,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments`)
          .set(bearer(dana))
          .send({ body: "ping the bell" })
          .expect(201);
      },
    );
    expect(frames.some((f) => f.startsWith("event: notification"))).toBe(true);
  });

  it("does not ping a non-recipient's notification stream", async () => {
    const dana = await login("dana.reyes@acme.com");
    const kai = await login("kai.t@acme.com"); // unrelated agent (Field Services)
    const frames = await collect(
      `${API}/notifications/stream`,
      kai,
      async () => {
        await request(app)
          .post(`${API}/tickets/1042/comments`)
          .set(bearer(dana))
          .send({ body: "not for kai" })
          .expect(201);
      },
    );
    expect(frames.some((f) => f.startsWith("event: notification"))).toBe(false);
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
// audit_logs starts empty after resetDb (the seed writes no audit rows), so each
// test controls exactly what ends up in the trail.
describe("audit trail read", () => {
  const ENDPOINT = `${API}/audit`;

  const entityIds = (res: { body: { data: Array<{ entityId: number }> } }) =>
    res.body.data.map((e) => e.entityId);

  /** Produce one Acme audit row and one Globex audit row. */
  async function makeCrossCustomerActivity() {
    const dana = await login("dana.reyes@acme.com"); // Acme agent
    await request(app)
      .patch(`${API}/tickets/1042/priority`)
      .set(bearer(dana))
      .send({ priority: "critical" })
      .expect(200);

    const owen = await login("owen.park@acme.com"); // Globex agent
    await request(app)
      .patch(`${API}/tickets/2001/priority`)
      .set(bearer(owen))
      .send({ priority: "low" })
      .expect(200);
  }

  it("lets an admin read every customer's entries", async () => {
    await makeCrossCustomerActivity();
    const admin = await login("sam.rivera@acme.com"); // platform admin, no customer
    const res = await request(app).get(ENDPOINT).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(entityIds(res)).toContain(1042);
    expect(entityIds(res)).toContain(2001);
  });

  // The tenant boundary: audit_logs has no customer_id of its own, so scope is
  // derived from the actor. A manager must not see another customer's activity.
  it("confines a manager to their own customer's entries", async () => {
    await makeCrossCustomerActivity();
    const morgan = await login("morgan.lee@acme.com"); // Acme manager
    const res = await request(app).get(ENDPOINT).set(bearer(morgan));
    expect(res.status).toBe(200);
    expect(entityIds(res)).toContain(1042);
    expect(entityIds(res)).not.toContain(2001);
  });

  it("shows the other side of the boundary to the other customer's manager", async () => {
    await makeCrossCustomerActivity();
    const nadia = await login("nadia.kofi@acme.com"); // Globex manager
    const res = await request(app).get(ENDPOINT).set(bearer(nadia));
    expect(entityIds(res)).toContain(2001);
    expect(entityIds(res)).not.toContain(1042);
  });

  it("forbids an agent (403) — the trail is management work", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app).get(ENDPOINT).set(bearer(dana)).expect(403);
  });

  it("forbids a requester (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    await request(app).get(ENDPOINT).set(bearer(marcus)).expect(403);
  });

  it("requires authentication (401)", async () => {
    await request(app).get(ENDPOINT).expect(401);
  });

  it("filters by action prefix so a whole family matches", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app)
      .patch(`${API}/tickets/1042/priority`)
      .set(bearer(dana))
      .send({ priority: "critical" })
      .expect(200);
    await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "note" })
      .expect(201);

    const morgan = await login("morgan.lee@acme.com");
    const res = await request(app)
      .get(`${ENDPOINT}?action=ticket`)
      .set(bearer(morgan));
    expect(res.status).toBe(200);
    const actions: string[] = res.body.data.map(
      (e: { action: string }) => e.action,
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.startsWith("ticket."))).toBe(true);
  });

  // Filters are AND-ed with the scope clause, so no filter can widen visibility.
  it("cannot widen scope through a filter", async () => {
    await makeCrossCustomerActivity();
    const morgan = await login("morgan.lee@acme.com"); // Acme
    const res = await request(app)
      .get(`${ENDPOINT}?entity=ticket&entityId=2001`)
      .set(bearer(morgan));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("paginates with a scoped total in meta", async () => {
    const dana = await login("dana.reyes@acme.com");
    for (const priority of ["low", "medium", "high"]) {
      await request(app)
        .patch(`${API}/tickets/1042/priority`)
        .set(bearer(dana))
        .send({ priority })
        .expect(200);
    }

    const morgan = await login("morgan.lee@acme.com");
    const page = await request(app)
      .get(`${ENDPOINT}?limit=2&offset=0`)
      .set(bearer(morgan));
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(page.body.meta.limit).toBe(2);

    const next = await request(app)
      .get(`${ENDPOINT}?limit=2&offset=2`)
      .set(bearer(morgan));
    const firstIds: number[] = page.body.data.map((e: { id: number }) => e.id);
    const nextIds: number[] = next.body.data.map((e: { id: number }) => e.id);
    expect(nextIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it("returns newest first", async () => {
    const dana = await login("dana.reyes@acme.com");
    for (const priority of ["low", "high"]) {
      await request(app)
        .patch(`${API}/tickets/1042/priority`)
        .set(bearer(dana))
        .send({ priority })
        .expect(200);
    }
    const morgan = await login("morgan.lee@acme.com");
    const res = await request(app).get(ENDPOINT).set(bearer(morgan));
    const ids: number[] = res.body.data.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("rejects an out-of-range limit (400)", async () => {
    const morgan = await login("morgan.lee@acme.com");
    await request(app)
      .get(`${ENDPOINT}?limit=500`)
      .set(bearer(morgan))
      .expect(400);
  });

  it("lists the distinct action names in scope", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app)
      .patch(`${API}/tickets/1042/priority`)
      .set(bearer(dana))
      .send({ priority: "critical" })
      .expect(200);

    const morgan = await login("morgan.lee@acme.com");
    const res = await request(app)
      .get(`${ENDPOINT}/actions`)
      .set(bearer(morgan));
    expect(res.status).toBe(200);
    expect(res.body.data).toContain("ticket.priority_change");
  });

  // The trail is append-only by construction: no write route is registered.
  it("has no write surface — POST and DELETE are not routed", async () => {
    const admin = await login("sam.rivera@acme.com"); // platform admin, no customer
    const post = await request(app)
      .post(ENDPOINT)
      .set(bearer(admin))
      .send({ action: "forged.entry", entity: "ticket" });
    expect(post.status).toBe(404);
    const del = await request(app).delete(`${ENDPOINT}/1`).set(bearer(admin));
    expect(del.status).toBe(404);
  });
});

describe("problems — linking and converting", () => {
  const problemOn = (ticketId: number) => `${API}/tickets/${ticketId}/problem`;

  /** Convert a ticket into a new problem and return the created problem. */
  async function convert(token: string, ticketId: number, title: string) {
    const res = await request(app)
      .post(problemOn(ticketId))
      .set(bearer(token))
      .send({ title });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; title: string; ticketCount: number };
  }

  it("converts a ticket into a new problem (201) and links it", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1042, "VPN gateway 4.2 regression");
    expect(problem.title).toBe("VPN gateway 4.2 regression");

    // The ticket now carries the link, which is what the rail renders.
    const ticket = await request(app)
      .get(`${API}/tickets/1042`)
      .set(bearer(dana));
    expect(ticket.body.data.problem).toMatchObject({
      id: problem.id,
      title: "VPN gateway 4.2 regression",
      status: "investigating",
    });
  });

  // The whole point of problems: many incidents, one root cause.
  it("links several incidents to one problem and counts them", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1042, "Shared drive outage");

    for (const ticketId of [1035, 1029]) {
      const res = await request(app)
        .post(problemOn(ticketId))
        .set(bearer(dana))
        .send({ problemId: problem.id });
      // Linking is a 200 — nothing new was created.
      expect(res.status).toBe(200);
    }

    const list = await request(app)
      .get(`${API}/problems?search=Shared drive`)
      .set(bearer(dana));
    expect(list.status).toBe(200);
    const found = (list.body.data as Array<{ id: number; ticketCount: number }>)
      .find((p) => p.id === problem.id);
    expect(found?.ticketCount).toBe(3);
  });

  it("unlinks a ticket without deleting the problem (204)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1042, "Printer firmware fault");

    await request(app)
      .delete(problemOn(1042))
      .set(bearer(dana))
      .expect(204);

    const ticket = await request(app)
      .get(`${API}/tickets/1042`)
      .set(bearer(dana));
    expect(ticket.body.data.problem).toBeNull();

    // The problem survives — unlinking one incident must not destroy the record.
    const still = await request(app)
      .get(`${API}/problems/${problem.id}`)
      .set(bearer(dana));
    expect(still.status).toBe(200);
  });

  it("rejects passing both problemId and title (400)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1035, "Ambiguity check");
    await request(app)
      .post(problemOn(1042))
      .set(bearer(dana))
      .send({ problemId: problem.id, title: "also this" })
      .expect(400);
  });

  it("rejects passing neither (400)", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app)
      .post(problemOn(1042))
      .set(bearer(dana))
      .send({})
      .expect(400);
  });

  it("forbids a requester from linking (403)", async () => {
    const marcus = await login("marcus.chen@acme.com"); // requester of 1042
    await request(app)
      .post(problemOn(1042))
      .set(bearer(marcus))
      .send({ title: "should not work" })
      .expect(403);
  });

  it("404s converting a ticket outside the actor's scope", async () => {
    const dana = await login("dana.reyes@acme.com"); // Acme
    await request(app)
      .post(problemOn(2001)) // Globex
      .set(bearer(dana))
      .send({ title: "cross-tenant attempt" })
      .expect(404);
  });

  // Linking is a write that names a problem id, so it must not become a way to
  // discover or attach to another tenant's problem.
  it("404s linking to another customer's problem", async () => {
    const owen = await login("owen.park@acme.com"); // Globex agent
    const globexProblem = await convert(owen, 2001, "Globex badge reader");

    const dana = await login("dana.reyes@acme.com"); // Acme agent
    await request(app)
      .post(problemOn(1042))
      .set(bearer(dana))
      .send({ problemId: globexProblem.id })
      .expect(404);
  });

  it("scopes the problem list to the caller's customer", async () => {
    const owen = await login("owen.park@acme.com");
    await convert(owen, 2001, "Globex only problem");
    const dana = await login("dana.reyes@acme.com");
    await convert(dana, 1042, "Acme only problem");

    const asDana = await request(app).get(`${API}/problems`).set(bearer(dana));
    const titles: string[] = asDana.body.data.map(
      (p: { title: string }) => p.title,
    );
    expect(titles).toContain("Acme only problem");
    expect(titles).not.toContain("Globex only problem");
  });

  it("lets a platform admin see every customer's problems", async () => {
    const owen = await login("owen.park@acme.com");
    await convert(owen, 2001, "Globex side");
    const dana = await login("dana.reyes@acme.com");
    await convert(dana, 1042, "Acme side");

    const sam = await login("sam.rivera@acme.com");
    const res = await request(app).get(`${API}/problems`).set(bearer(sam));
    const titles: string[] = res.body.data.map((p: { title: string }) => p.title);
    expect(titles).toContain("Acme side");
    expect(titles).toContain("Globex side");
  });

  // The two writes are audited against different entities on purpose: creating a
  // problem is a fact about the problem, linking is a fact about the ticket.
  it("audits the conversion against the problem and the unlink against the ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1042, "Audited problem");
    await request(app).delete(problemOn(1042)).set(bearer(dana)).expect(204);

    const onProblem = await prisma.auditLog.findMany({
      where: { entity: "problem", entityId: problem.id },
      select: { action: true, meta: true },
    });
    expect(onProblem.map((a) => a.action)).toContain(
      "problem.create_from_ticket",
    );
    expect(onProblem[0].meta).toMatchObject({ ticketId: 1042 });

    const onTicket = await prisma.auditLog.findMany({
      where: { entity: "ticket", entityId: 1042 },
      select: { action: true },
    });
    expect(onTicket.map((a) => a.action)).toContain("problem.unlink_ticket");
  });

  // Before PATCH existed, rootCause/workaround/status were write-once at
  // creation — so a "known error" could never acquire the workaround the status
  // promises. These pin the rule that makes the status mean something.
  describe("editing the investigation", () => {
    it("updates root cause, workaround and status", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "VPN 4.2 regression");

      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({
          rootCause: "Gateway rejects OTP after the 4.2 upgrade",
          workaround: "Use the legacy 4.1 client until the patch lands",
          status: "known_error",
        });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("known_error");
      expect(res.body.data.workaround).toContain("legacy 4.1");
      expect(res.body.data.rootCause).toContain("OTP");
    });

    it("refuses known_error without a workaround (400)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "No workaround yet");

      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/workaround/i);

      // And it really didn't move.
      const after = await prisma.problem.findUniqueOrThrow({
        where: { id: problem.id },
      });
      expect(after.status).toBe("investigating");
    });

    it("allows known_error when the workaround arrives in the same request", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Same-request workaround");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error", workaround: "Restart the print spooler" })
        .expect(200);
    });

    // The rules judge the resulting state, not the patch.
    it("allows known_error later, using the stored workaround", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Stored workaround");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ workaround: "Use the web client" })
        .expect(200);
      // Second call sends only the status.
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error" })
        .expect(200);
    });

    it("refuses to clear the workaround out from under known_error (400)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Clear guard");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error", workaround: "Use the web client" })
        .expect(200);

      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ workaround: null })
        .expect(400);
    });

    it("rejects an empty patch and an unknown field (400)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Validator checks");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({})
        .expect(400);
      // .strict() — a typo'd key must not silently no-op.
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ rootCauze: "typo" })
        .expect(400);
    });

    it("forbids a requester (403)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Requester guard");
      const marcus = await login("marcus.chen@acme.com");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(marcus))
        .send({ rootCause: "nope" })
        .expect(403);
    });

    it("404s another customer's problem instead of leaking it", async () => {
      const owen = await login("owen.park@acme.com"); // Globex
      const globex = await convert(owen, 2001, "Globex internal");
      const dana = await login("dana.reyes@acme.com"); // Acme
      await request(app)
        .patch(`${API}/problems/${globex.id}`)
        .set(bearer(dana))
        .send({ rootCause: "cross-tenant write" })
        .expect(404);

      const untouched = await prisma.problem.findUniqueOrThrow({
        where: { id: globex.id },
      });
      expect(untouched.rootCause).toBeNull();
    });

    it("notifies the assignees of linked incidents when a workaround lands", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Announce me");
      // 1027 is Acme, assigned to Ana M. — a different agent.
      await request(app)
        .post(`${API}/tickets/1027/problem`)
        .set(bearer(dana))
        .send({ problemId: problem.id })
        .expect(200);

      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error", workaround: "Use the web client" })
        .expect(200);

      const ana = await prisma.user.findUniqueOrThrow({
        where: { email: "ana.m@acme.com" },
      });
      const notes = await prisma.notification.findMany({
        where: { userId: ana.id, type: "problem.workaround_available" },
      });
      expect(notes).toHaveLength(1);
      expect(notes[0].ticketId).toBe(1027);
    });

    it("does not re-notify when an existing known error is edited again", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "No repeat");
      await request(app)
        .post(`${API}/tickets/1027/problem`)
        .set(bearer(dana))
        .send({ problemId: problem.id })
        .expect(200);
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "known_error", workaround: "first text" })
        .expect(200);

      const countAfterFirst = await prisma.notification.count({
        where: { type: "problem.workaround_available" },
      });

      // Correcting a typo must not interrupt everyone a second time.
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ workaround: "clearer text" })
        .expect(200);

      expect(
        await prisma.notification.count({
          where: { type: "problem.workaround_available" },
        }),
      ).toBe(countAfterFirst);
    });

    it("audits the edit with field names but not free-text contents", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Audit me");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ rootCause: "a very secret internal detail", status: "resolved" })
        .expect(200);

      const row = await prisma.auditLog.findFirstOrThrow({
        where: {
          entity: "problem",
          entityId: problem.id,
          action: "problem.update",
        },
      });
      const meta = row.meta as { fields: string[]; status?: string };
      expect(meta.fields).toContain("rootCause");
      expect(meta.status).toBe("resolved");
      // Free text can run to 5k chars; the trail records that it changed only.
      expect(JSON.stringify(meta)).not.toContain("secret internal detail");
    });

    // The KB has no table, so nothing at the database level can reject a bad
    // article id — validation on write is the only thing preventing dangling
    // references, and resolution on read is what makes a stale one visible.
    it("links a KB article and resolves it on read", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Outlook prompts");

      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: "KB-042" });
      expect(res.status).toBe(200);
      expect(res.body.data.kbArticleId).toBe("KB-042");
      expect(res.body.data.kbArticle).toMatchObject({ id: "KB-042" });
      expect(typeof res.body.data.kbArticle.title).toBe("string");
      expect(res.body.data.kbArticle.title.length).toBeGreaterThan(0);
    });

    it("rejects an article id that does not exist (400)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Bad reference");

      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: "KB-does-not-exist" });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/knowledge-base article/i);

      const after = await prisma.problem.findUniqueOrThrow({
        where: { id: problem.id },
      });
      expect(after.kbArticleId).toBeNull();
    });

    it("unlinks the article with null", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Unlink kb");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: "KB-042" })
        .expect(200);

      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: null });
      expect(res.status).toBe(200);
      expect(res.body.data.kbArticleId).toBeNull();
      expect(res.body.data.kbArticle).toBeNull();
    });

    // A reference can go stale when an article is dropped from the dataset. The
    // problem must still load, with the link reported as unavailable.
    it("reports a stale reference instead of failing the read", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Stale reference");
      // Write a now-missing id directly — the API would reject it, which is the
      // point: this state can only arise from the KB dataset changing later.
      await prisma.problem.update({
        where: { id: problem.id },
        data: { kbArticleId: "KB-retired" },
      });

      const res = await request(app)
        .get(`${API}/problems/${problem.id}`)
        .set(bearer(dana));
      expect(res.status).toBe(200);
      expect(res.body.data.kbArticleId).toBe("KB-retired");
      expect(res.body.data.kbArticle).toBeNull();
    });

    it("keeps the article link through an unrelated edit", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Sticky link");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: "KB-042" })
        .expect(200);

      // Patching only the status must not disturb the reference.
      const res = await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ status: "resolved" });
      expect(res.body.data.kbArticleId).toBe("KB-042");
    });

    it("exposes the article on the list endpoint too", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Listed with kb");
      await request(app)
        .patch(`${API}/problems/${problem.id}`)
        .set(bearer(dana))
        .send({ kbArticleId: "KB-042" })
        .expect(200);

      const list = await request(app)
        .get(`${API}/problems?search=Listed with kb`)
        .set(bearer(dana));
      const found = (
        list.body.data as Array<{ id: number; kbArticle: { id: string } | null }>
      ).find((p) => p.id === problem.id);
      expect(found?.kbArticle?.id).toBe("KB-042");
    });

    it("permits any status transition (no whitelist, unlike tickets)", async () => {
      const dana = await login("dana.reyes@acme.com");
      const problem = await convert(dana, 1042, "Transitions");
      for (const status of ["resolved", "closed", "investigating"] as const) {
        await request(app)
          .patch(`${API}/problems/${problem.id}`)
          .set(bearer(dana))
          .send({ status })
          .expect(200);
      }
    });
  });

  it("audits a link to an existing problem", async () => {
    const dana = await login("dana.reyes@acme.com");
    const problem = await convert(dana, 1042, "Link audit");
    await request(app)
      .post(problemOn(1035))
      .set(bearer(dana))
      .send({ problemId: problem.id })
      .expect(200);

    const rows = await prisma.auditLog.findMany({
      where: { entity: "ticket", entityId: 1035, action: "problem.link_ticket" },
      select: { meta: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ problemId: problem.id });
  });
});

// The notifications table doubles as an email outbox: rows are written inside the
// mutation's transaction, and this sweep mails the ones still unstamped. SMTP is
// unset in tests, so the mail adapter is the "log" transport — these assert the
// outbox bookkeeping, which is where the real risk lives.
describe("notifications — email delivery sweep", () => {
  const HOUR = 60 * 60 * 1000;

  const pendingCount = () =>
    prisma.notification.count({ where: { emailedAt: null } });

  /** Produce one real notification: a public reply notifies the requester. */
  async function makeNotification() {
    const dana = await login("dana.reyes@acme.com");
    await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "Looking into it now." })
      .expect(201);
  }

  it("mails a pending notification and stamps it", async () => {
    await makeNotification();
    expect(await pendingCount()).toBeGreaterThan(0);

    const res = await notificationService.sweepEmail();
    expect(res.sent).toBeGreaterThan(0);
    expect(res.failed).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  // The property that matters for a recurring sweep.
  it("does not re-send on the next pass", async () => {
    await makeNotification();
    const first = await notificationService.sweepEmail();
    expect(first.sent).toBeGreaterThan(0);

    const second = await notificationService.sweepEmail();
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.failed).toBe(0);
  });

  it("does nothing when there is nothing pending", async () => {
    await notificationService.sweepEmail(); // drain the seed-driven rows, if any
    expect(await notificationService.sweepEmail()).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  // A long disable-then-enable gap must not mail a whole backlog.
  it("retires notifications older than the max age without sending", async () => {
    await makeNotification();
    const rows = await prisma.notification.findMany({
      where: { emailedAt: null },
      select: { id: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    await prisma.notification.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { createdAt: new Date(Date.now() - 48 * HOUR) },
    });

    const res = await notificationService.sweepEmail();
    expect(res.sent).toBe(0);
    // Stamped anyway, so they stop being scanned forever.
    expect(await pendingCount()).toBe(0);
  });

  it("skips internal notes but still stamps them", async () => {
    const dana = await login("dana.reyes@acme.com");
    // Drain anything already pending so the counts below are unambiguous.
    await notificationService.sweepEmail();

    await request(app)
      .post(`${API}/tickets/1042/comments`)
      .set(bearer(dana))
      .send({ body: "Internal: escalating to network ops.", internal: true })
      .expect(201);

    // An internal note notifies the assignee side only, never the requester.
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const toRequester = await prisma.notification.count({
      where: { userId: marcus.id, emailedAt: null },
    });
    expect(toRequester).toBe(0);

    await notificationService.sweepEmail();
    expect(await pendingCount()).toBe(0);
  });

  it("stamps every row it handles, so the outbox drains", async () => {
    // Several notifications across different tickets in one pass.
    const dana = await login("dana.reyes@acme.com");
    for (const ticketId of [1042, 1035, 1025]) {
      await request(app)
        .post(`${API}/tickets/${ticketId}/comments`)
        .set(bearer(dana))
        .send({ body: `update on ${ticketId}` })
        .expect(201);
    }
    const before = await pendingCount();
    expect(before).toBeGreaterThanOrEqual(3);

    const res = await notificationService.sweepEmail();
    expect(res.sent + res.skipped).toBe(before);
    expect(await pendingCount()).toBe(0);
  });

  it("leaves the in-app feed unaffected by email delivery", async () => {
    await makeNotification();
    await notificationService.sweepEmail();

    // Emailing must not mark anything read — those are independent states.
    const marcus = await login("marcus.chen@acme.com");
    const feed = await request(app)
      .get(`${API}/notifications`)
      .set(bearer(marcus));
    expect(feed.status).toBe(200);
    expect(feed.body.data.length).toBeGreaterThan(0);
    expect(feed.body.meta.unread).toBeGreaterThan(0);
  });
});
