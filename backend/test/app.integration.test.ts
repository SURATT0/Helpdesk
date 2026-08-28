import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import {
  canTransition,
  type TicketStatus,
} from "../src/shared/ticket-status";
import { ticketService } from "../src/modules/tickets/ticket.service";
import { notificationService } from "../src/modules/notifications/notification.service";
import { authService } from "../src/modules/auth/auth.service";
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

  // The sweep bounds the refresh_tokens table for accounts that never log in
  // again — the login-time cleanup only ever reaches the user logging in. What
  // matters is WHICH rows it takes: a revoked token that has not expired yet must
  // survive, because reuse-detection needs it to recognise a replay.
  it("sweep deletes expired refresh tokens but keeps revoked-but-unexpired ones", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    const hour = 60 * 60 * 1000;
    const rows = [
      { name: "expired-live", expiresAt: new Date(Date.now() - hour), revokedAt: null },
      { name: "expired-revoked", expiresAt: new Date(Date.now() - hour), revokedAt: new Date() },
      { name: "current-live", expiresAt: new Date(Date.now() + hour), revokedAt: null },
      { name: "current-revoked", expiresAt: new Date(Date.now() + hour), revokedAt: new Date() },
    ];
    for (const r of rows) {
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          familyId: `sweep-${r.name}`,
          tokenHash: `sweep-hash-${r.name}`,
          expiresAt: r.expiresAt,
          revokedAt: r.revokedAt,
        },
      });
    }

    const deleted = await authService.sweepExpiredSessions();
    expect(deleted).toBeGreaterThanOrEqual(2); // both expired rows, whatever else the suite left

    const survivors = await prisma.refreshToken.findMany({
      where: { familyId: { startsWith: "sweep-" } },
      select: { familyId: true },
    });
    expect(survivors.map((s) => s.familyId).sort()).toEqual([
      "sweep-current-live",
      "sweep-current-revoked", // kept on purpose: still inside its validity window
    ]);

    // And nothing expired is left anywhere, which is the point of the sweep.
    const stillExpired = await prisma.refreshToken.count({
      where: { expiresAt: { lt: new Date() } },
    });
    expect(stillExpired).toBe(0);
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
    await prisma.ticket.update({ where: { id: 1031 }, data: { status: "new" } });

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

/**
 * Routing projects sit at manager level and up: project:read to see them,
 * project:write to change them, held together so the two never disagree. Reads
 * were previously ungated — no test covered that, which is how the reversal went
 * unnoticed, so the whole surface is pinned here.
 *
 * Seeded: 1 = Acme Migration, 2 = Acme Facilities (customer 1), 3 = Globex Rollout
 * (customer 2).
 */
/**
 * A name already in use is the client's mistake, and the API has to say which
 * one. Every unique constraint in the schema used to escape as a 500 with
 * "Something went wrong" and the real reason buried in the server log — the
 * middleware now maps Prisma's P2002. Projects are where it is reachable through
 * the API, so they are where it is asserted.
 */
describe("duplicates answer 409, not 500", () => {
  /**
   * The owner is looked up rather than hardcoded: `resetDb()` truncates with
   * RESTART IDENTITY, so ids are stable within a run but need not match any
   * other database — and the owner has to be staff of the actor's customer or
   * the request is refused before it ever reaches the constraint.
   */
  const acmeOwner = () =>
    prisma.user.findUniqueOrThrow({ where: { email: "dana.reyes@acme.com" } });

  const create = async (token: string, name: string) =>
    request(app)
      .post(`${API}/projects`)
      .set(bearer(token))
      .send({ name, ownerId: (await acmeOwner()).id });

  it("refuses a second project with a name already used in that customer", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const first = await create(morgan, "Duplicate check");
    expect(first.status).toBe(201);

    const second = await create(morgan, "Duplicate check");
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
    // Names the columns that collided, camelCased as the client sent them.
    expect(second.body.error.details.fields).toEqual(["customerId", "name"]);
    // And says something a person can act on.
    expect(second.body.error.message).toMatch(/already exists/i);
  });

  it("refuses a rename onto an existing name", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const created = await create(morgan, "Rename source");
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`${API}/projects/${created.body.data.id}`)
      .set(bearer(morgan))
      .send({ name: "Acme Migration" }); // seeded, same customer
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("allows the same name in a different customer", async () => {
    // The constraint is (customerId, name), so this is not a collision — and a
    // 409 here would be the fix over-reaching.
    const sam = await login("sam.rivera@acme.com"); // platform-wide
    const globex = await prisma.customer.findFirstOrThrow({
      where: { name: "Globex Inc" },
    });
    const owen = await prisma.user.findUniqueOrThrow({
      where: { email: "owen.park@acme.com" },
    });
    const res = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({ name: "Acme Migration", ownerId: owen.id, customerId: globex.id });
    expect(res.status).toBe(201);
  });
});

describe("projects — permission level and row scope", () => {
  const list = (token: string) =>
    request(app).get(`${API}/projects`).set(bearer(token));
  const detail = (token: string, id: number) =>
    request(app).get(`${API}/projects/${id}`).set(bearer(token));

  const namesOf = (res: { body: { data: { name: string }[] } }) =>
    res.body.data.map((p) => p.name);

  it("lets a manager read their own customer's projects, and no others", async () => {
    const morgan = await login("morgan.lee@acme.com"); // manager, Acme
    const res = await list(morgan);
    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual(
      expect.arrayContaining(["Acme Migration", "Acme Facilities"]),
    );
    expect(namesOf(res)).not.toContain("Globex Rollout");
  });

  it("lets a platform admin read every customer's projects", async () => {
    const sam = await login("sam.rivera@acme.com");
    const res = await list(sam);
    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual(
      expect.arrayContaining(["Acme Migration", "Globex Rollout"]),
    );
  });

  it("scopes a manager of another customer to their own", async () => {
    const nadia = await login("nadia.kofi@acme.com"); // manager, Globex
    const res = await list(nadia);
    expect(namesOf(res)).toEqual(["Globex Rollout"]);
  });

  it("lets an admin read the routing table, scoped to their own customer", async () => {
    // Reading is desk work — it says where a queue's work comes from — so
    // `project:read` reaches admin. Changing an owner is still management work and
    // is refused below. Row scope applies as it does for a super admin.
    const dana = await login("dana.reyes@acme.com"); // admin, Acme
    const res = await list(dana);
    expect(res.status).toBe(200);
    expect(namesOf(res)).toContain("Acme Migration");
    expect(namesOf(res)).not.toContain("Globex Rollout");

    const own = await detail(dana, 2);
    expect(own.status).toBe(200);
  });

  it("refuses a requester", async () => {
    const marcus = await login("marcus.chen@acme.com");
    await list(marcus).expect(403);
    await detail(marcus, 1).expect(403);
  });

  it("still refuses an agent's write, as it always did", async () => {
    const dana = await login("dana.reyes@acme.com");
    await request(app)
      .patch(`${API}/projects/2`)
      .set(bearer(dana))
      .send({ backupOwnerId: null })
      .expect(403);
  });

  it("lets a manager set the owners", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const ana = await prisma.user.findUniqueOrThrow({
      where: { email: "ana.m@acme.com" },
    });
    const res = await request(app)
      .patch(`${API}/projects/2`) // Acme Facilities
      .set(bearer(morgan))
      .send({ backupOwnerId: ana.id });
    expect(res.status).toBe(200);
    expect(res.body.data.backupOwner.id).toBe(ana.id);
  });

  it("404s another customer's project for a manager instead of leaking it", async () => {
    const morgan = await login("morgan.lee@acme.com"); // Acme
    await detail(morgan, 3).expect(404); // Globex Rollout
  });

  it("requires authentication", async () => {
    await request(app).get(`${API}/projects`).expect(401);
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

describe("tickets — SLA states the seed guarantees", () => {
  const list = (token: string) =>
    request(app).get(`${API}/tickets`).set(bearer(token));

  /**
   * The seed ages some in-flight tickets so their SLA target has already passed.
   * Before that every seeded ticket was raised at seed time, so nothing could be
   * late and the whole breached-and-still-open branch was unreachable in a fresh
   * database — including from the E2E suite.
   */
  it("ships tickets that are past due and still open", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await list(dana);
    expect(res.status).toBe(200);

    const now = Date.now();
    const overdue = res.body.data.filter(
      (t: { status: string; dueAt: string | null }) =>
        t.dueAt != null &&
        Date.parse(t.dueAt) < now &&
        ["new", "open", "in_progress"].includes(t.status),
    );
    expect(overdue.length).toBeGreaterThanOrEqual(2);
    // The server's own verdict agrees — this is the state the badge paints red.
    expect(
      overdue.every((t: { slaState: string }) => t.slaState === "danger"),
    ).toBe(true);
  });

  it("ships one about to breach and one comfortably ahead", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await list(dana);
    const active = res.body.data.filter((t: { status: string }) =>
      ["new", "open", "in_progress"].includes(t.status),
    );
    const remaining = (t: { dueAt: string }) => Date.parse(t.dueAt) - Date.now();

    // A demo with only breaches is as unrealistic as one with none: the point is
    // that every tier the badge can paint is reachable.
    expect(
      active.some(
        (t: { dueAt: string }) =>
          remaining(t) > 0 && remaining(t) < 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      active.some((t: { dueAt: string }) => remaining(t) > 4 * 60 * 60 * 1000),
    ).toBe(true);
  });

  it("judges a pending ticket on when the work finished, not on a countdown", async () => {
    // Pending is the end of the desk's part: `resolved_at` is stamped on the way
    // in and the target is judged against it there and then. A countdown would
    // be charging the requester's reply time to the desk's SLA — which is what
    // pending did while `resolved` carried the "done" meaning.
    const dana = await login("dana.reyes@acme.com");
    const res = await list(dana);
    const pending = res.body.data.filter(
      (t: { status: string }) => t.status === "pending",
    );
    expect(pending.length).toBeGreaterThan(0);
    for (const ticket of pending) {
      expect(["met", "danger"]).toContain(ticket.slaState);
      expect(["met", "breached"]).toContain(ticket.slaDue);
      expect(ticket.resolvedAt).not.toBeNull();
    }
  });
});

describe("tickets — list ordering", () => {
  it("orders by the SLA target, breaking ties on id", async () => {
    // `due_at` is the creation time plus a fixed per-priority target, so any two
    // tickets of the same priority created in the same instant — a CSV import, a
    // burst of self-service tickets — share one to the millisecond. Without a
    // tiebreaker their order is whatever the query plan produces.
    const category = await prisma.category.findFirstOrThrow();
    const requester = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const dueAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const ids = [9101, 9102, 9103];
    for (const id of [...ids].reverse()) {
      await prisma.ticket.create({
        data: {
          id,
          subject: `Tied target ${id}`,
          description: "same due_at",
          status: "new",
          priority: "high",
          requesterId: requester.id,
          categoryId: category.id,
          customerId: requester.customerId,
          dueAt,
        },
      });
    }

    const dana = await login("dana.reyes@acme.com");
    const seen = async () => {
      const res = await request(app).get(`${API}/tickets`).set(bearer(dana));
      return res.body.data
        .map((t: { id: number }) => t.id)
        .filter((id: number) => ids.includes(id));
    };

    expect(await seen()).toEqual(ids);
    // Stable, not merely correct once: the same question twice gives the same
    // answer, which is what pagination and "the row hasn't moved" depend on.
    expect(await seen()).toEqual(ids);
  });
});

/**
 * What a requester reaches, across every surface that counts tickets.
 *
 * All four go through `ticketScopeWhere`, so for role `user` they resolve to
 * "tickets I raised" — and the knowledge base deliberately does not, because an
 * article is the same article for everyone. That is already how it behaves; this
 * pins it down, since a scope that is correct by habit rather than by test is one
 * refactor away from not being.
 */
describe("scope — a requester sees only their own, except the KB", () => {
  const REQUESTER = "marcus.chen@acme.com";

  /**
   * Somebody else's ticket in the same customer — closed, raised by l.osei.
   * Not 1042: that one is Marcus's own, which is exactly the mistake this
   * constant is named to prevent.
   */
  const OTHERS_TICKET = 1001;

  it("lists only the tickets they raised", async () => {
    const marcus = await login(REQUESTER);
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const res = await request(app).get(`${API}/tickets`).set(bearer(marcus));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const mine = await prisma.ticket.findMany({
      where: { requesterId: me.id, deletedAt: null },
      select: { id: true },
    });
    expect(res.body.data.map((t: { id: number }) => t.id).sort()).toEqual(
      mine.map((t) => t.id).sort(),
    );
  });

  it("cannot open someone else's ticket, and is told it is missing", async () => {
    // 404 rather than 403: a forbidden here would confirm the ticket exists.
    const marcus = await login(REQUESTER);
    const res = await request(app)
      .get(`${API}/tickets/${OTHERS_TICKET}`)
      .set(bearer(marcus));
    expect(res.status).toBe(404);
  });

  it("cannot reach someone else's ticket through the closed history", async () => {
    const marcus = await login(REQUESTER);
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const res = await request(app)
      .get(`${API}/tickets/closed?granularity=all&limit=200&offset=0`)
      .set(bearer(marcus));
    expect(res.status).toBe(200);
    for (const t of res.body.data as { requesterEmail: string }[]) {
      expect(t.requesterEmail).toBe(me.email);
    }
  });

  it("cannot search past the scope either", async () => {
    // The free-text filter runs inside the scope clause, not around it — a
    // requester searching a colleague's subject must still come back empty.
    const other = await prisma.ticket.findUniqueOrThrow({
      where: { id: OTHERS_TICKET },
    });
    const marcus = await login(REQUESTER);
    const res = await request(app)
      .get(
        `${API}/tickets/closed?granularity=all&limit=50&offset=0&q=${encodeURIComponent(
          other.subject,
        )}`,
      )
      .set(bearer(marcus));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("counts only their own on the dashboard", async () => {
    const marcus = await login(REQUESTER);
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const res = await request(app)
      .get(`${API}/dashboard/summary`)
      .set(bearer(marcus));
    expect(res.status).toBe(200);

    const mine = await prisma.ticket.count({
      where: { requesterId: me.id, deletedAt: null },
    });
    expect(res.body.data.stats.totalTickets).toBe(mine);

    // And that is smaller than what an admin of the same customer sees.
    const dana = await login("dana.reyes@acme.com");
    const asAdmin = await request(app)
      .get(`${API}/dashboard/summary`)
      .set(bearer(dana));
    expect(asAdmin.body.data.stats.totalTickets).toBeGreaterThan(mine);
  });

  it("reports only on their own", async () => {
    const marcus = await login(REQUESTER);
    const res = await request(app)
      .get(`${API}/reports/sla-summary`)
      .set(bearer(marcus));
    expect(res.status).toBe(200);
    // Row scope narrows every figure to Marcus's own tickets, so his SLA sample
    // is a subset of what an admin of the same customer is judged over.
    const dana = await login("dana.reyes@acme.com");
    const asAdmin = await request(app)
      .get(`${API}/reports/sla-summary`)
      .set(bearer(dana));
    expect(res.body.data.kpis.judgedCount).toBeLessThan(
      asAdmin.body.data.kpis.judgedCount,
    );

    // This used to compare the two `byAgent` tables. That field is gone from
    // this endpoint entirely — per-agent throughput moved behind its own gate
    // (test/workload-visibility.integration.test.ts), and a requester was never
    // meant to be handed a list of the staff who worked their tickets.
    expect(res.body.data.byAgent).toBeUndefined();
    expect(asAdmin.body.data.byAgent).toBeUndefined();
  });

  it("cannot browse the asset register", async () => {
    // The register lists every machine in the customer with its holder's name and
    // email. 403 rather than an empty list: this is a permission the role does not
    // hold, not a scope that happens to match nothing — and what a requester needs
    // about their own hardware is embedded in their ticket as `affectedAssets`.
    const marcus = await login(REQUESTER);
    await request(app).get(`${API}/assets`).set(bearer(marcus)).expect(403);
    await request(app).get(`${API}/assets/1`).set(bearer(marcus)).expect(403);

    const dana = await login("dana.reyes@acme.com");
    const asAdmin = await request(app).get(`${API}/assets`).set(bearer(dana));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.length).toBeGreaterThan(0);
  });

  it("cannot browse the problem register", async () => {
    const marcus = await login(REQUESTER);
    await request(app).get(`${API}/problems`).set(bearer(marcus)).expect(403);

    const dana = await login("dana.reyes@acme.com");
    const asAdmin = await request(app).get(`${API}/problems`).set(bearer(dana));
    expect(asAdmin.status).toBe(200);
  });

  it("still reads the problem their own ticket is linked to, and no other", async () => {
    const dana = await login("dana.reyes@acme.com");
    // 1042 is Marcus's; 1001 is somebody else's in the same customer.
    const mine = await request(app)
      .post(`${API}/tickets/1042/problem`)
      .set(bearer(dana))
      .send({ title: "VPN gateway regression" });
    expect(mine.status).toBe(201);
    const theirs = await request(app)
      .post(`${API}/tickets/${OTHERS_TICKET}/problem`)
      .set(bearer(dana))
      .send({ title: "Somebody else's cause" });
    expect(theirs.status).toBe(201);

    const marcus = await login(REQUESTER);
    // Theirs: the workaround on the problem holding up their own ticket is the
    // reason a requester may read one at all.
    const own = await request(app)
      .get(`${API}/problems/${mine.body.data.id}`)
      .set(bearer(marcus));
    expect(own.status).toBe(200);
    expect(own.body.data.title).toBe("VPN gateway regression");

    // Not theirs: same customer, same endpoint, but no ticket of Marcus's on it.
    // 404, so the answer cannot confirm the problem exists either.
    await request(app)
      .get(`${API}/problems/${theirs.body.data.id}`)
      .set(bearer(marcus))
      .expect(404);
  });

  it("reads the same knowledge base as everyone else", async () => {
    // The one surface that is deliberately not scoped: articles carry no
    // customer, so an article is the same article whoever opens it. Status is the
    // only thing that narrows the list, and the seeded library is all published —
    // drafts are covered in the knowledge base suite below.
    const marcus = await login(REQUESTER);
    const dana = await login("dana.reyes@acme.com");

    const asRequester = await request(app).get(`${API}/kb`).set(bearer(marcus));
    const asAdmin = await request(app).get(`${API}/kb`).set(bearer(dana));
    expect(asRequester.status).toBe(200);
    expect(asAdmin.status).toBe(200);
    expect(asRequester.body.data.length).toBeGreaterThan(0);
    expect(asRequester.body.data.map((a: { id: number }) => a.id)).toEqual(
      asAdmin.body.data.map((a: { id: number }) => a.id),
    );
  });
});

describe("reports — what the resolution clock measures", () => {
  /**
   * Marcus raises tickets but is in nobody's closed history, and a requester's
   * report is scoped to their own tickets — so a ticket built here is the only
   * thing his figures are drawn from, and the arithmetic can be asserted exactly
   * instead of "roughly, mixed in with the seed".
   */
  const HOUR = 3_600_000;

  async function ticketFor(
    marcusId: number,
    times: { raised: Date; openedAt: Date | null; closedAt: Date | null },
  ) {
    const category = await prisma.category.findFirstOrThrow();
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { id: marcusId },
    });
    const ticket = await prisma.ticket.create({
      data: {
        subject: "Measured ticket",
        description: "for the resolution clock",
        status: times.closedAt ? "closed" : "pending",
        priority: "medium",
        requesterId: marcus.id,
        categoryId: category.id,
        customerId: marcus.customerId,
        createdAt: times.raised,
        resolvedAt: times.closedAt ?? times.raised,
        closedAt: times.closedAt,
      },
    });
    if (times.openedAt) {
      // What both clocks now start from: the desk's first PUBLIC reply. An
      // internal note is the desk talking to itself and a status move is not
      // something the requester sees, so neither counts as having answered.
      const dana = await prisma.user.findUniqueOrThrow({
        where: { email: "dana.reyes@acme.com" },
      });
      await prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: dana.id,
          body: "Looking into this now.",
          internal: false,
          createdAt: times.openedAt,
        },
      });
    }
    return ticket;
  }

  const summary = async (token: string) => {
    const res = await request(app)
      .get(`${API}/reports/sla-summary`)
      .set(bearer(token));
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it("runs from the first reply to being closed, not from being raised", async () => {
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const raised = new Date(Date.now() - 30 * HOUR);
    // Sat in the queue overnight, then handled in four hours.
    await ticketFor(marcus.id, {
      raised,
      openedAt: new Date(raised.getTime() + 20 * HOUR),
      closedAt: new Date(raised.getTime() + 24 * HOUR),
    });

    const data = await summary(await login("marcus.chen@acme.com"));
    // 4, not 24: the twenty hours before anyone answered were never work.
    expect(data.kpis.avgHandlingHours).toBe(4);
    expect(data.kpis.handledCount).toBe(1);
  });

  it("measures to closed, not to the moment the work was finished", async () => {
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const raised = new Date(Date.now() - 10 * HOUR);
    // Finished but never confirmed — pending, with no closing time, so there is
    // no handling clock to read even though the desk's part is over.
    await ticketFor(marcus.id, {
      raised,
      openedAt: new Date(raised.getTime() + 1 * HOUR),
      closedAt: null,
    });

    const data = await summary(await login("marcus.chen@acme.com"));
    expect(data.kpis.handledCount).toBe(0);
    expect(data.kpis.avgHandlingHours).toBe(0);
  });

  it("skips a ticket that was closed without ever being picked up", async () => {
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const raised = new Date(Date.now() - 6 * HOUR);
    await ticketFor(marcus.id, {
      raised,
      openedAt: null,
      closedAt: new Date(raised.getTime() + 2 * HOUR),
    });

    // Nothing recorded the pickup, so there is no start — better to leave it out
    // than to fall back to the creation time and quietly reintroduce the queue.
    const data = await summary(await login("marcus.chen@acme.com"));
    expect(data.kpis.handledCount).toBe(0);
  });

  it("times the first response from raise to the desk's first reply", async () => {
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    const raised = new Date(Date.now() - 30 * HOUR);
    await ticketFor(marcus.id, {
      raised,
      openedAt: new Date(raised.getTime() + 20 * HOUR),
      closedAt: new Date(raised.getTime() + 24 * HOUR),
    });

    // That wait is exactly what this KPI is for, so it keeps its own start.
    const data = await summary(await login("marcus.chen@acme.com"));
    expect(data.kpis.medianFirstResponseMin).toBe(20 * 60);
  });

  it("counts the daily trend on closures, matching the headline", async () => {
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });
    // Resolved four days ago, closed today. Counting resolutions put this on the
    // wrong bar — a chart of one event sitting under a KPI measuring to another.
    const raised = new Date(Date.now() - 5 * 24 * HOUR);
    const ticket = await ticketFor(marcus.id, {
      raised,
      openedAt: new Date(raised.getTime() + HOUR),
      closedAt: new Date(),
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { resolvedAt: new Date(Date.now() - 4 * 24 * HOUR) },
    });

    const data = await summary(await login("marcus.chen@acme.com"));
    const trend = data.closureTrend as { day: string; count: number }[];
    expect(trend).toHaveLength(7);
    // Today is the last bar, and it holds the closure.
    expect(trend.at(-1)!.count).toBe(1);
    expect(trend.slice(0, -1).every((d) => d.count === 0)).toBe(true);

    // Each bucket names the day it counted, so the client can label the axis
    // from the same calendar that cut it instead of rebuilding the window.
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(trend.at(-1)!.day).toBe(
      `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    );
    expect(trend.map((d) => d.day)).toEqual([...trend.map((d) => d.day)].sort());
  });

  it("gives an agent's average the same clock as the headline", async () => {
    // The per-agent table lives on its own gated route now, so this reads it
    // there — but the property under test is unchanged and still worth pinning:
    // the two figures must be one measurement. They are computed from shared
    // helpers in the repository precisely so this cannot drift.
    const morgan = await login("morgan.lee@acme.com"); // super_admin
    const data = await summary(morgan);
    const table = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(morgan));
    expect(table.status).toBe(200);

    const rows = table.body.data as {
      agent: string;
      handled: number;
      avgHandlingHours: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.avgHandlingHours >= 0)).toBe(true);

    // The check that actually binds them: the per-agent rows are the ASSIGNED
    // subset of the very tickets the headline is averaged over, so their counts
    // must sum to no more than the headline's sample. A second clock — measuring
    // to `resolved_at`, say, or from creation — would change which tickets have a
    // handling time at all and break this.
    const kpis = data.kpis as { handledCount: number };
    const counted = rows.reduce((n, r) => n + r.handled, 0);
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThanOrEqual(kpis.handledCount);
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

  /**
   * The status facet asks for what the reader was SHOWN, and the two derived
   * values share a stored one — so this is the pair that can go wrong: New and
   * In Progress are both `status = 'new'`, separated only by the assignee.
   */
  describe("the status facet", () => {
    const list = (token: string, status: string) =>
      request(app).get(`${API}/tickets?status=${status}`).set(bearer(token));

    it("gives In Progress only the taken tickets", async () => {
      const dana = await login("dana.reyes@acme.com");
      const res = await list(dana, "in_progress");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const t of res.body.data as Array<{
        status: string;
        displayStatus: string;
        assigneeId: number | null;
      }>) {
        expect(t.displayStatus).toBe("in_progress");
        expect(t.status).toBe("new");
        expect(t.assigneeId).not.toBeNull();
      }
    });

    it("gives New only the untaken ones", async () => {
      const dana = await login("dana.reyes@acme.com");
      const res = await list(dana, "new");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const t of res.body.data as Array<{
        status: string;
        displayStatus: string;
        assigneeId: number | null;
      }>) {
        expect(t.displayStatus).toBe("new");
        expect(t.status).toBe("new");
        expect(t.assigneeId).toBeNull();
      }
    });

    it("adds up: the four facets are the whole list, counted once each", async () => {
      // Nothing lost between two filters, nothing counted by both — the
      // property that makes the facet counts trustworthy at all.
      const dana = await login("dana.reyes@acme.com");
      const all = await request(app).get(`${API}/tickets`).set(bearer(dana));
      const allIds = (all.body.data as Array<{ id: number }>).map((t) => t.id);

      const perFacet = await Promise.all(
        ["new", "in_progress", "pending", "closed"].map(async (s) => {
          const res = await list(dana, s);
          expect(res.status).toBe(200);
          return (res.body.data as Array<{ id: number }>).map((t) => t.id);
        }),
      );

      const union = perFacet.flat();
      expect(union.length).toBe(allIds.length);
      expect(new Set(union).size).toBe(union.length); // no id twice
      expect([...union].sort()).toEqual([...allIds].sort());
    });

    it("refuses a status the model retired", async () => {
      // `open` and `resolved` are not values a reader can be shown, so they are
      // not values the facet accepts — 400 rather than an empty list, which
      // would read as "there are none" instead of "there is no such thing".
      const dana = await login("dana.reyes@acme.com");
      for (const gone of ["open", "resolved"]) {
        const res = await list(dana, gone);
        expect(res.status).toBe(400);
      }
    });
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

  // The assignee filter is AND-ed with row scope, never a way around it — and it
  // is now permissioned on top of that, so the two guards are checked separately.
  it("cannot reach another customer's tickets through the filter", async () => {
    const owen = await prisma.user.findUniqueOrThrow({
      where: { email: "owen.park@acme.com" }, // Globex agent
    });

    // An Acme admin is stopped by the workload gate before scope even applies:
    // naming a colleague is refused whoever the colleague is.
    const dana = await login("dana.reyes@acme.com"); // Acme, admin
    const refused = await request(app)
      .get(`${API}/tickets?assigneeId=${owen.id}`)
      .set(bearer(dana));
    expect(refused.status).toBe(403);

    // Acme's own super admin passes that gate — and then row scope is what keeps
    // Globex out, which is the property this test has always been about.
    const morgan = await login("morgan.lee@acme.com"); // Acme, super_admin
    const scoped = await request(app)
      .get(`${API}/tickets?assigneeId=${owen.id}`)
      .set(bearer(morgan));
    expect(scoped.status).toBe(200);
    expect(scoped.body.data).toHaveLength(0);
  });
});

describe("tickets — status transitions", () => {
  it("allows a legal transition and appends a history row", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1035/status`) // new → pending (the work is done)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("pending");
    // 1035 has an assignee, so before the move it READ as In Progress; now the
    // work is finished, both values say pending.
    expect(res.body.data.displayStatus).toBe("pending");
    const history = await prisma.ticketStatusHistory.count({
      where: { ticketId: 1035 },
    });
    expect(history).toBe(2); // initial + this change
  });

  it("rejects an illegal transition with 409", async () => {
    const dana = await login("dana.reyes@acme.com");
    // Close it first, then try to finish it: closed → pending is not a move the
    // whitelist has (a closed ticket may only be reopened).
    await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(dana))
      .send({ status: "closed" })
      .expect(200);
    const res = await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("never records an illegal transition when two agents race one ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    // 1035 is `new`, from which BOTH of these are legal — so both requests pass
    // the service's guard against their own read. Only one may win: neither
    // `pending → closed` nor `closed → pending` may be applied on top of the
    // other's result without the whitelist saying so, and applying the loser on
    // top of the winner is exactly what used to persist it.
    const [a, b] = await Promise.all([
      request(app)
        .patch(`${API}/tickets/1035/status`)
        .set(bearer(dana))
        .send({ status: "closed" }),
      request(app)
        .patch(`${API}/tickets/1035/status`)
        .set(bearer(dana))
        .send({ status: "pending" }),
    ]);

    // Both moves are legal from `new`, so one wins outright. The loser is
    // refused because the row it read is no longer the row it would write.
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    // Which 409 depends on whether the loser read before or after the winner
    // committed; both are correct refusals.
    expect(["CONCURRENT_STATUS_CHANGE", "ILLEGAL_TRANSITION"]).toContain(
      loser.body.error.code,
    );

    // The invariant that matters, and the one that is timing-independent: every
    // transition on record is one the whitelist allows. `fromStatus: null` is
    // the seeded opening row, which is not a transition.
    const rows = await prisma.ticketStatusHistory.findMany({
      where: { ticketId: 1035 },
      orderBy: { id: "asc" },
      select: { fromStatus: true, toStatus: true },
    });
    for (const row of rows) {
      if (row.fromStatus == null) continue;
      expect(
        canTransition(
          row.fromStatus as TicketStatus,
          row.toStatus as TicketStatus,
        ),
      ).toBe(true);
    }
  });

  it("treats a re-sent identical status as a no-op, not a second history row", async () => {
    const dana = await login("dana.reyes@acme.com");
    const send = () =>
      request(app)
        .patch(`${API}/tickets/1035/status`) // new → pending
        .set(bearer(dana))
        .send({ status: "pending" });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200); // double submit
    const history = await prisma.ticketStatusHistory.count({
      where: { ticketId: 1035 },
    });
    expect(history).toBe(2); // seeded row + one real change, not two
  });

  it("forbids a requester from changing status (403)", async () => {
    const marcus = await login("marcus.chen@acme.com");
    const res = await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(marcus))
      .send({ status: "pending" });
    expect(res.status).toBe(403);
  });

  it("404s a status change on another customer's ticket", async () => {
    const dana = await login("dana.reyes@acme.com"); // Acme
    const res = await request(app)
      .patch(`${API}/tickets/2002/status`) // Globex ticket
      .set(bearer(dana))
      .send({ status: "pending" });
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
      .send({ status: "new" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("new");
    // The assignee is kept, so it comes back as their In Progress rather than
    // dropping into the unassigned queue.
    expect(res.body.data.assigneeId).not.toBeNull();
    expect(res.body.data.displayStatus).toBe("in_progress");
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
      .send({ status: "new" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REOPEN_WINDOW_EXPIRED");
  });
});

describe("tickets — auto-close (pending > 72h)", () => {
  it("closes a ticket left pending beyond 72h and logs the transition", async () => {
    await prisma.ticket.update({
      where: { id: 1031 }, // seeded as pending: finished, awaiting confirmation
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

  it("leaves a ticket that only just finished alone", async () => {
    // #1031 reached pending as the seed ran → its 72h have not passed
    const closed = await ticketService.autoCloseStale(new Date());
    expect(closed).toBe(0);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: 1031 } });
    expect(t.status).toBe("pending");
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

  /**
   * A pending ticket is finished work waiting to be confirmed, so its resolution
   * target has already been met or missed — `resolved_at` is stamped on the way
   * in. Alerting on it would breach every ticket whose requester simply took
   * their time answering, over work the desk had already done.
   *
   * This is the opposite of what pending meant before the three-value model,
   * when `resolved` carried "done" and pending meant "parked, still ours". These
   * tests are that reversal, stated as three cases so it cannot drift back.
   */
  it("never alerts on a pending ticket, however far past its target", async () => {
    // 1039 is seeded pending, and deliberately given a clock that is long gone.
    await prisma.ticket.update({
      where: { id: 1039 },
      data: { dueAt: inHours(-5) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.breached).toBe(0);
    expect(await slaNotifications(1039)).toHaveLength(0);
  });

  it("does not warn a pending ticket that is merely close either", async () => {
    await prisma.ticket.update({
      where: { id: 1039 },
      data: { dueAt: inHours(2) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.warned).toBe(0);
    expect(await slaNotifications(1039)).toHaveLength(0);
  });

  it("still alerts on unfinished work, assigned or not", async () => {
    // The other side of the same rule: `new` covers New and In Progress, and
    // both are work the desk still owes an answer on.
    await prisma.ticket.update({
      where: { id: 1044 }, // new, unassigned
      data: { dueAt: inHours(-5) },
    });
    const res = await ticketService.sweepSlaAlerts(now);
    expect(res.breached).toBe(1);
    expect((await slaNotifications(1044))[0].type).toBe("ticket.sla_breach");
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

  // A ticket with no customer is unreachable, not merely untidy: ticketScopeWhere
  // matches staff on customerId equality, so it would be invisible to every
  // customer-bound admin. The platform-wide super_admin is the one principal whose
  // own customerId is null, so they are the only caller who can reach this path.
  it("refuses a requester with no customer (400), rather than filing outside every tenant", async () => {
    const sam = await login("sam.rivera@acme.com"); // super_admin, customerId null
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(sam))
      .send({
        subject: "Raised by platform staff with no tenant",
        description: "Should be refused, not filed with a null customer.",
        categoryId: await categoryId("Hardware"),
        priority: "low",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no tenant to file this ticket under/i);

    // And nothing was written: no tenant-less ticket exists after the attempt.
    const stranded = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM tickets WHERE customer_id IS NULL`;
    expect(Number(stranded[0].count)).toBe(0);
  });
});

// Deleting a ticket is the escape hatch for a row that should never have existed,
// so it is super-admin only AND still bound by row scope. Soft: the row and its
// history stay, but no read returns it — including the platform-wide super admin's,
// which is the one reach that sees everything else.
describe("tickets — delete (super admin only, soft)", () => {
  async function anAcmeTicket(): Promise<number> {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "Raised to be deleted",
        description: "x",
        categoryId: await categoryId("Hardware"),
        priority: "low",
      });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  it("refuses an admin with 403 — the button is not the gate", async () => {
    const id = await anAcmeTicket();
    const dana = await login("dana.reyes@acme.com"); // admin
    const res = await request(app).delete(`${API}/tickets/${id}`).set(bearer(dana));
    expect(res.status).toBe(403);

    // Still readable: nothing was half-done.
    const after = await request(app).get(`${API}/tickets/${id}`).set(bearer(dana));
    expect(after.status).toBe(200);
  });

  it("refuses a plain user with 403", async () => {
    const id = await anAcmeTicket();
    const marcus = await login("marcus.chen@acme.com"); // user
    const res = await request(app).delete(`${API}/tickets/${id}`).set(bearer(marcus));
    expect(res.status).toBe(403);
  });

  it("lets a super admin delete, and the ticket then reads as not found for everyone", async () => {
    const id = await anAcmeTicket();
    const morgan = await login("morgan.lee@acme.com"); // super_admin, Acme
    const del = await request(app).delete(`${API}/tickets/${id}`).set(bearer(morgan));
    expect(del.status).toBe(204);

    // Gone for the deleter, for the admin working the case, and for the
    // platform-wide super admin whose reach otherwise covers every customer.
    for (const email of [
      "morgan.lee@acme.com",
      "dana.reyes@acme.com",
      "sam.rivera@acme.com",
    ]) {
      const token = await login(email);
      const get = await request(app).get(`${API}/tickets/${id}`).set(bearer(token));
      expect(get.status).toBe(404);
      const list = await request(app)
        .get(`${API}/tickets?limit=200`)
        .set(bearer(token));
      expect(
        (list.body.data.items ?? list.body.data).some(
          (t: { id: number }) => t.id === id,
        ),
      ).toBe(false);
    }

    // Soft: the row is still on disk, with its status history intact, and the
    // deletion itself is recorded — the only trace left once the ticket is unreadable.
    const row = await prisma.ticket.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await prisma.ticketStatusHistory.count({ where: { ticketId: id } })).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { entity: "ticket", entityId: id, action: "ticket.delete" },
      }),
    ).toBe(1);
  });

  it("does not let a customer-bound super admin reach another tenant's ticket", async () => {
    const id = await anAcmeTicket(); // Acme
    const nadia = await login("nadia.kofi@acme.com"); // super_admin, customer 2
    const res = await request(app).delete(`${API}/tickets/${id}`).set(bearer(nadia));
    expect(res.status).toBe(404); // out of scope reads as absent, not forbidden

    const row = await prisma.ticket.findUnique({ where: { id } });
    expect(row?.deletedAt).toBeNull();
  });
});

// Priority and requester left the history table and became filters, so they have
// to narrow the period on the server — the client no longer renders either as a
// column to filter by eye.
describe("tickets — closed history filters", () => {
  const closed = (token: string, qs = "") =>
    request(app).get(`${API}/tickets/closed?granularity=year${qs}`).set(bearer(token));

  it("narrows by priority, and combines with the period", async () => {
    const dana = await login("dana.reyes@acme.com");
    const all = await closed(dana);
    expect(all.status).toBe(200);
    const priorities = new Set<string>(
      all.body.data.map((t: { priority: string }) => t.priority),
    );
    expect(priorities.size).toBeGreaterThan(1); // otherwise the filter proves nothing

    // Taken from the data rather than hardcoded: which priorities the seed closes
    // in the current year is not something this test should depend on.
    const [pick] = [...priorities];
    const narrowed = await closed(dana, `&priority=${pick}`);
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.data.length).toBeGreaterThan(0);
    expect(
      narrowed.body.data.every((t: { priority: string }) => t.priority === pick),
    ).toBe(true);
    expect(narrowed.body.meta.total).toBeLessThan(all.body.meta.total);
  });

  it("searches subject and requester name, case-insensitively", async () => {
    const dana = await login("dana.reyes@acme.com");
    const all = await closed(dana);
    const sample = all.body.data[0] as { subject: string; requester: string };

    // A word from the subject finds it.
    const word = sample.subject.split(/\s+/).find((w: string) => w.length > 4);
    const bySubject = await closed(dana, `&q=${encodeURIComponent(word!.toUpperCase())}`);
    expect(bySubject.status).toBe(200);
    expect(
      bySubject.body.data.some((t: { id: number }) => t.id === (sample as unknown as { id: number }).id),
    ).toBe(true);

    // So does the requester's name, which is the other half of "I half-remember it".
    const byRequester = await closed(
      dana,
      `&q=${encodeURIComponent(sample.requester.split(" ")[0].toLowerCase())}`,
    );
    expect(byRequester.status).toBe(200);
    expect(byRequester.body.data.length).toBeGreaterThan(0);
    expect(
      byRequester.body.data.every(
        (t: { subject: string; requester: string }) =>
          t.requester.toLowerCase().includes(sample.requester.split(" ")[0].toLowerCase()) ||
          t.subject.toLowerCase().includes(sample.requester.split(" ")[0].toLowerCase()),
      ),
    ).toBe(true);
  });

  it("keeps row scope while filtering — a filter cannot widen what you see", async () => {
    // #1020 is a Globex closure pinned to the PREVIOUS year by the seed, so both
    // sides query that year rather than the current one.
    const lastYear = new Date(
      Date.UTC(new Date().getUTCFullYear() - 1, 5, 21),
    ).toISOString();
    const q = `&anchor=${encodeURIComponent(lastYear)}&q=${encodeURIComponent("Mailbox migration")}`;

    // Searching for it by name must not reach across the tenant boundary.
    const dana = await login("dana.reyes@acme.com"); // Acme
    const hidden = await closed(dana, q);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toHaveLength(0);

    const owen = await login("owen.park@acme.com"); // Globex staff
    const theirs = await closed(owen, q);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.length).toBeGreaterThan(0);
  });

  it("ignores a blank search rather than matching nothing", async () => {
    const dana = await login("dana.reyes@acme.com");
    const all = await closed(dana);
    const blank = await closed(dana, "&q=%20%20");
    expect(blank.status).toBe(200);
    expect(blank.body.meta.total).toBe(all.body.meta.total);
  });

  it("finds a ticket by its id, with or without the #", async () => {
    const dana = await login("dana.reyes@acme.com");
    const all = await closed(dana);
    const sample = all.body.data[0] as { id: number };

    for (const q of [String(sample.id), `%23${sample.id}`]) {
      const res = await closed(dana, `&q=${q}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { id: number }) => t.id)).toContain(sample.id);
    }
  });

  it("finds a ticket by the requester's email", async () => {
    const dana = await login("dana.reyes@acme.com");
    const all = await closed(dana);
    const sample = all.body.data[0] as { id: number; requesterEmail: string };

    const res = await closed(
      dana,
      `&q=${encodeURIComponent(sample.requesterEmail.toUpperCase())}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { id: number }) => t.id)).toContain(sample.id);
  });

  it("does not let an id search reach outside row scope", async () => {
    // The id is an exact match, which is the easiest way to accidentally bypass a
    // WHERE clause: asking for another tenant's ticket by number must find nothing.
    const dana = await login("dana.reyes@acme.com"); // Acme
    const res = await closed(dana, "&q=1020"); // a Globex closure
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { id: number }) => t.id)).not.toContain(1020);
  });

  it("does not mistake an out-of-range number for an id", async () => {
    // Larger than int4: matching `id` on it would make Postgres raise rather than
    // return an empty page, so the number must only be tried against the text.
    const dana = await login("dana.reyes@acme.com");
    const res = await closed(dana, "&q=99999999999999");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("tickets — closed history over the whole archive", () => {
  const all = (token: string, qs = "") =>
    request(app)
      .get(`${API}/tickets/closed?granularity=all${qs}`)
      .set(bearer(token));

  /**
   * The point of `all`: a log that can only be read one calendar window at a time
   * cannot be searched, because narrowing by month presupposes knowing the month.
   */
  it("spans periods that a single window cannot, newest first", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await all(dana, "&limit=200");
    expect(res.status).toBe(200);

    const closedAts = res.body.data.map((t: { closedAt: string }) =>
      Date.parse(t.closedAt),
    );
    expect(closedAts.length).toBeGreaterThan(0);
    expect([...closedAts].sort((a: number, b: number) => b - a)).toEqual(closedAts);

    // Strictly more than the current year holds — the seed closes tickets several
    // years back, and that is exactly what one window cannot reach.
    const thisYear = await request(app)
      .get(`${API}/tickets/closed?granularity=year&limit=200`)
      .set(bearer(dana));
    expect(res.body.meta.total).toBeGreaterThan(thisYear.body.meta.total);
  });

  it("reports no period, because there is no window to label", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await all(dana);
    expect(res.status).toBe(200);
    expect(res.body.meta.period).toBeNull();
  });

  it("ignores an anchor instead of quietly re-bucketing by it", async () => {
    const dana = await login("dana.reyes@acme.com");
    const anchored = await all(
      dana,
      `&limit=200&anchor=${encodeURIComponent(new Date(2000, 0, 1).toISOString())}`,
    );
    const plain = await all(dana, "&limit=200");
    expect(anchored.body.meta.total).toBe(plain.body.meta.total);
  });

  it("still only shows what the viewer may see", async () => {
    // The widest possible query is where a scope bug would surface: a requester
    // asking for the whole archive must still get only their own closures.
    // L. Osei rather than any requester: the seed gives them closures across
    // several years, so a scope leak has something to leak past.
    const requester = await login("l.osei@acme.com");
    const res = await all(requester, "&limit=200");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(
      res.body.data.every(
        (t: { requesterEmail: string }) => t.requesterEmail === "l.osei@acme.com",
      ),
    ).toBe(true);

    const dana = await login("dana.reyes@acme.com");
    const staff = await all(dana, "&limit=200");
    expect(staff.body.meta.total).toBeGreaterThan(res.body.meta.total);
  });

  it("pages the archive with limit/offset", async () => {
    const dana = await login("dana.reyes@acme.com");
    const first = await all(dana, "&limit=2&offset=0");
    const second = await all(dana, "&limit=2&offset=2");
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.total).toBe(second.body.meta.total);
    expect(idsIn(second)).not.toEqual(idsIn(first));
  });

  it("pages a tie in closedAt without repeating or dropping a row", async () => {
    // Bulk closures share a timestamp — the auto-close sweep closes in batches —
    // and `closedAt` alone leaves their order to the query plan. Without a
    // tiebreaker two consecutive pages can show the same ticket and never show
    // the other, which is exactly what paging the whole archive would hit.
    const at = new Date();
    await prisma.ticket.updateMany({
      where: { id: { in: [1029, 1031] } },
      data: { status: "closed", closedAt: at },
    });

    const dana = await login("dana.reyes@acme.com");
    const first = await all(dana, "&limit=1&offset=0");
    const second = await all(dana, "&limit=1&offset=1");
    expect(idsIn(first)).toEqual([1031]);
    expect(idsIn(second)).toEqual([1029]);
  });

  it("combines the archive with the filters", async () => {
    const dana = await login("dana.reyes@acme.com");
    const unfiltered = await all(dana, "&limit=200");
    const sample = unfiltered.body.data.at(-1) as { id: number; subject: string };

    // Deliberately the OLDEST closure: finding it proves the search left the
    // current window, which is the whole reason this mode exists.
    const word = sample.subject.split(/\s+/).find((w: string) => w.length > 4);
    const found = await all(dana, `&limit=200&q=${encodeURIComponent(word!)}`);
    expect(found.status).toBe(200);
    expect(found.body.data.map((t: { id: number }) => t.id)).toContain(sample.id);
    expect(found.body.meta.total).toBeLessThan(unfiltered.body.meta.total);
  });

  it("requires authentication", async () => {
    await request(app).get(`${API}/tickets/closed?granularity=all`).expect(401);
  });
});

/** Ids in a closed-history response, in the order the server returned them. */
function idsIn(res: { body: { data: { id: number }[] } }): number[] {
  return res.body.data.map((t) => t.id);
}

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

  /** Push every revoked token further into the past than the reuse leeway. */
  async function ageOutRevocations() {
    const past = new Date(Date.now() - (env.refreshReuseLeewaySec + 60) * 1000);
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: past },
    });
  }

  it("rotates the refresh token on every use", async () => {
    const login = await request(app).post(`${API}/auth/login`).send(creds).expect(200);
    const rt1 = refreshCookie(login);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    expect(refreshCookie(refreshed)).not.toBe(rt1);
  });

  // The race this exists for: two page loads whose access tokens expired together
  // both refresh with the same cookie, and the second lands just after the first
  // rotated it. That is a retry, not a theft — serving it is what stops an innocent
  // user (and the E2E suite under load) being logged out mid-navigation.
  it("serves a replay inside the leeway and leaves the family alive", async () => {
    const login = await request(app).post(`${API}/auth/login`).send(creds).expect(200);
    const rt1 = refreshCookie(login);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    const rt2 = refreshCookie(refreshed);

    // The straggler, replaying the token the rotation just superseded.
    const retry = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    expect(refreshCookie(retry)).not.toBe(rt1);

    // And the family is untouched: the successor from the first rotation still works.
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt2).expect(200);
  });

  it("treats a replay after the leeway as compromise and revokes the family", async () => {
    const login = await request(app).post(`${API}/auth/login`).send(creds).expect(200);
    const rt1 = refreshCookie(login);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    const rt2 = refreshCookie(refreshed);

    await ageOutRevocations(); // the replay is no longer a plausible race

    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt1).expect(401);
    // Reuse detection still burns the whole family, so the live successor dies too.
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

  // The leeway must not become a way back in after signing out. Logout revokes
  // every token in the family and mints no successor, so nothing is live to make
  // the replay look like a rotation race — even one arriving immediately.
  it("does not let the leeway revive a session that was logged out", async () => {
    const login = await request(app).post(`${API}/auth/login`).send(creds).expect(200);
    const rt1 = refreshCookie(login);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", rt1)
      .expect(200);
    const rt2 = refreshCookie(refreshed);

    await request(app).post(`${API}/auth/logout`).set("Cookie", rt2).expect(200);

    // Both the rotated token and the logged-out one, replayed well inside the
    // leeway. Neither may work.
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt1).expect(401);
    await request(app).post(`${API}/auth/refresh`).set("Cookie", rt2).expect(401);
  });
});

/**
 * Retiring an account.
 *
 * There is no `DELETE /users` and there cannot be: `Ticket.requesterId` is
 * RESTRICT, so removing anyone who ever raised a ticket would mean erasing their
 * history with them. `isActive: false` is the door instead — no sign-in, no
 * session, no new work — and it is a different switch from
 * `availableForAssignment`, which is only a rota.
 */
describe("users — deactivation", () => {
  const patch = (token: string, id: number, body: Record<string, unknown>) =>
    request(app).patch(`${API}/users/${id}`).set(bearer(token)).send(body);

  /**
   * Staff with no assignments of their own to get in the way.
   *
   * It has to be someone a queue genuinely could be handed to, or a refusal
   * proves nothing about `isActive` — a requester is turned away on their role
   * alone, whether their account is open or shut.
   */
  const spareStaff = () =>
    prisma.user.findUniqueOrThrow({ where: { email: "morgan.lee@acme.com" } });

  /**
   * Morgan is also Acme's only super admin in the seed, so the last-admin guard
   * would refuse to retire them before any of this got a chance to fail for the
   * reason under test. Promoting Kai first is the order the product asks for
   * anyway: someone else holds the role, then the leaver can go.
   */
  async function keepAnAdminBehind(token: string) {
    const kai = await prisma.user.findUniqueOrThrow({
      where: { email: "kai.t@acme.com" },
    });
    const res = await request(app)
      .patch(`${API}/users/${kai.id}`)
      .set(bearer(token))
      .send({ role: "super_admin" });
    expect(res.status).toBe(200);
  }

  it("closes the door: no login, and the session dies at its next refresh", async () => {
    const sam = await login("sam.rivera@acme.com"); // platform-wide
    const target = await prisma.user.findUniqueOrThrow({
      where: { email: "j.petrov@acme.com" },
    });

    // A live session first, so we can watch it end rather than just fail to start.
    const before = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: "password123" });
    expect(before.status).toBe(200);
    const cookie = before.headers["set-cookie"];

    const res = await patch(sam, target.id, { isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    // Cannot sign in again…
    const again = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: "password123" });
    expect(again.status).toBe(401);
    expect(again.body.error.message).toMatch(/deactivated/i);

    // …and the refresh cookie they still hold is refused too, so the tab they
    // left open stops working instead of running for another seven days.
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", cookie);
    expect(refreshed.status).toBe(401);
  });

  it("refuses to close an account that still holds unfinished work", async () => {
    const sam = await login("sam.rivera@acme.com");
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    const holding = await prisma.ticket.count({
      where: {
        assigneeId: dana.id,
        deletedAt: null,
        // The same set the guard counts — ACTIVE_STATUSES.
        status: { in: ["new", "pending"] },
      },
    });
    expect(holding).toBeGreaterThan(0);

    const res = await patch(sam, dana.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_HAS_OPEN_QUEUE");
    // The message says how many, so the reader knows the size of the job.
    expect(res.body.error.message).toContain(String(holding));

    // And nothing changed.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: dana.id },
    });
    expect(after.isActive).toBe(true);
  });

  it("accepts it once the queue has been handed over", async () => {
    // The order the API insists on, end to end.
    const sam = await login("sam.rivera@acme.com");
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    const kai = await prisma.user.findUniqueOrThrow({
      where: { email: "kai.t@acme.com" },
    });

    const handover = await request(app)
      .post(`${API}/tickets/reassign`)
      .set(bearer(sam))
      .send({ fromUserId: dana.id, toUserId: kai.id });
    expect(handover.status).toBe(200);

    const res = await patch(sam, dana.id, { isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it("refuses to close your own account", async () => {
    const sam = await login("sam.rivera@acme.com");
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: "sam.rivera@acme.com" },
    });
    const res = await patch(sam, me.id, { isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/your own account/i);
  });

  it("stops new work reaching a closed account", async () => {
    const sam = await login("sam.rivera@acme.com");
    await keepAnAdminBehind(sam);
    const target = await spareStaff();
    expect((await patch(sam, target.id, { isActive: false })).status).toBe(200);

    // A single ticket…
    const one = await request(app)
      .patch(`${API}/tickets/1042/assignee`)
      .set(bearer(sam))
      .send({ assigneeId: target.id });
    expect(one.status).toBe(403);

    // …a whole queue…
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: "dana.reyes@acme.com" },
    });
    const queue = await request(app)
      .post(`${API}/tickets/reassign`)
      .set(bearer(sam))
      .send({ fromUserId: dana.id, toUserId: target.id });
    expect(queue.status).toBe(403);

    // …and owning a routing project, which hands them tickets without anyone
    // choosing a name.
    // `customerId` is explicit because Sam is platform-wide and has none of their
    // own to infer — otherwise this 400s on the missing tenant and proves nothing.
    const owning = await request(app)
      .post(`${API}/projects`)
      .set(bearer(sam))
      .send({
        name: "Closed owner check",
        ownerId: target.id,
        customerId: target.customerId,
      });
    expect(owning.status).toBe(403);
  });

  it("records the change in the audit trail", async () => {
    const sam = await login("sam.rivera@acme.com");
    await keepAnAdminBehind(sam);
    const target = await spareStaff();
    expect((await patch(sam, target.id, { isActive: false })).status).toBe(200);

    const rows = await prisma.auditLog.findMany({
      where: { entity: "user", entityId: target.id, action: "user.update" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toMatchObject({ isActive: false });
  });

  it("can be reversed, and the account works again", async () => {
    const sam = await login("sam.rivera@acme.com");
    await keepAnAdminBehind(sam);
    const target = await spareStaff();
    await patch(sam, target.id, { isActive: false });
    expect((await patch(sam, target.id, { isActive: true })).status).toBe(200);

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: "password123" });
    expect(res.status).toBe(200);
  });

  it("is not the same switch as availability", async () => {
    // Marking someone unavailable must not shut them out, and must still let a
    // queue be handed to them — they are at lunch, not gone.
    const sam = await login("sam.rivera@acme.com");
    await keepAnAdminBehind(sam);
    const target = await spareStaff();
    expect(
      (await patch(sam, target.id, { availableForAssignment: false })).status,
    ).toBe(200);

    const stillIn = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: target.email, password: "password123" });
    expect(stillIn.status).toBe(200);

    const one = await request(app)
      .patch(`${API}/tickets/1042/assignee`)
      .set(bearer(sam))
      .send({ assigneeId: target.id });
    expect(one.status).toBe(200);
  });
});

/**
 * Nobody may remove the last person able to administer something.
 *
 * The seed has exactly one active super admin per group — one platform-wide, one
 * per customer — so every one of them is "the last", which is what makes these
 * assertions exact.
 *
 * The two cases are not equally bad and the guard says so: a customer left
 * without a super admin can still be helped by platform staff, while the last
 * platform-wide super admin is the end of the line, since only a platform-wide
 * super admin may grant that role.
 */
describe("users — the last administrator", () => {
  const patch = (token: string, id: number, body: Record<string, unknown>) =>
    request(app).patch(`${API}/users/${id}`).set(bearer(token)).send(body);

  const byEmail = (email: string) =>
    prisma.user.findUniqueOrThrow({ where: { email } });

  it("refuses to deactivate the only platform-wide super admin", async () => {
    const sam = await byEmail("sam.rivera@acme.com"); // platform-wide
    const morgan = await login("morgan.lee@acme.com");
    const res = await patch(morgan, sam.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
    expect(res.body.error.message).toMatch(/platform/i);
    expect((await byEmail("sam.rivera@acme.com")).isActive).toBe(true);
  });

  it("refuses to demote them, which costs the same thing", async () => {
    // Keying on the field sent rather than the effect would have missed this.
    const sam = await byEmail("sam.rivera@acme.com");
    const token = await login("sam.rivera@acme.com");
    const res = await patch(token, sam.id, { role: "admin" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
    expect((await byEmail("sam.rivera@acme.com")).role).toBe("super_admin");
  });

  it("refuses to deactivate a customer's only super admin", async () => {
    const morgan = await byEmail("morgan.lee@acme.com"); // super_admin, Acme
    const sam = await login("sam.rivera@acme.com");
    const res = await patch(sam, morgan.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
    // Recoverable, so the wording does not talk about the platform.
    expect(res.body.error.message).not.toMatch(/platform/i);
  });

  it("allows it once someone else holds the role", async () => {
    // The order the guard insists on: promote, then retire.
    const sam = await login("sam.rivera@acme.com");
    const kai = await byEmail("kai.t@acme.com"); // admin, Acme
    const morgan = await byEmail("morgan.lee@acme.com");

    expect((await patch(sam, kai.id, { role: "super_admin" })).status).toBe(200);
    const res = await patch(sam, morgan.id, { isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it("does not let one customer's super admin stand in for another's", async () => {
    // `customerId: null` is its own group, not a wildcard: Globex having a super
    // admin says nothing about Acme, and neither covers the platform.
    const sam = await login("sam.rivera@acme.com");
    const nadia = await byEmail("nadia.kofi@acme.com"); // super_admin, Globex
    const res = await patch(sam, nadia.id, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });

  it("leaves ordinary edits alone", async () => {
    // The guard must not fire on a change that costs nobody the role.
    const sam = await login("sam.rivera@acme.com");
    const morgan = await byEmail("morgan.lee@acme.com");
    const res = await patch(sam, morgan.id, { availableForAssignment: false });
    expect(res.status).toBe(200);
  });

  it("still allows deactivating someone who is not a super admin", async () => {
    const sam = await login("sam.rivera@acme.com");
    const petrov = await byEmail("j.petrov@acme.com"); // requester
    expect((await patch(sam, petrov.id, { isActive: false })).status).toBe(200);
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

  it("only a super admin can change a role", async () => {
    const dana = await login("dana.reyes@acme.com"); // admin — works cases, not people
    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: "marcus.chen@acme.com" },
    });

    await request(app)
      .patch(`${API}/users/${marcus.id}`)
      .set(bearer(dana))
      .send({ role: "admin" })
      .expect(403);

    // Promote someone to super_admin, then the write succeeds. They keep their
    // customerId, so this is a customer-bound super admin — enough to set roles
    // inside their own tenant.
    await prisma.user.update({
      where: { email: "ana.m@acme.com" },
      data: { role: "super_admin" },
    });
    const ana = await login("ana.m@acme.com");
    const res = await request(app)
      .patch(`${API}/users/${marcus.id}`)
      .set(bearer(ana))
      .send({ role: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("admin");
  });
});

/**
 * A super admin who belongs to a customer manages that customer only. Reach is
 * carried by customerId, not by the role name — which is what lets one role serve
 * both a platform owner and a single customer's manager.
 */
describe("users — customer-bound super admin", () => {
  async function userId(email: string): Promise<number> {
    return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  it("scopes their directory to their own customer", async () => {
    const morgan = await login("morgan.lee@acme.com"); // super_admin, Acme
    const res = await request(app).get(`${API}/users`).set(bearer(morgan));
    expect(res.status).toBe(200);
    const names: string[] = res.body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Dana Reyes"); // Acme
    expect(names).not.toContain("Owen Park"); // Globex — other customer
  });

  it("edits a user in their own customer", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const kaiId = await userId("kai.t@acme.com"); // Acme
    const res = await request(app)
      .patch(`${API}/users/${kaiId}`)
      .set(bearer(morgan))
      .send({ role: "admin" });
    expect(res.status).toBe(200);
  });

  it("404s on a user in another customer rather than leaking them", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const owenId = await userId("owen.park@acme.com"); // Globex
    await request(app)
      .patch(`${API}/users/${owenId}`)
      .set(bearer(morgan))
      .send({ role: "admin" })
      .expect(404);
  });

  // The escalation guard, and the whole reason granting keys on reach rather than
  // role: without it a customer's own super admin could promote past their tenant.
  it("cannot grant the super admin role", async () => {
    const morgan = await login("morgan.lee@acme.com");
    const kaiId = await userId("kai.t@acme.com");
    await request(app)
      .patch(`${API}/users/${kaiId}`)
      .set(bearer(morgan))
      .send({ role: "super_admin" })
      .expect(403);
  });

  it("lets a platform super admin grant the super admin role", async () => {
    // The counterpart to the guard above: no customer of their own, so allowed.
    const sam = await login("sam.rivera@acme.com");
    const kaiId = await userId("kai.t@acme.com");
    await request(app)
      .patch(`${API}/users/${kaiId}`)
      .set(bearer(sam))
      .send({ role: "super_admin" })
      .expect(200);
  });

  it("lets a platform super admin see + manage users across customers", async () => {
    const sam = await login("sam.rivera@acme.com"); // super_admin, no customer
    const list = await request(app).get(`${API}/users`).set(bearer(sam));
    const names: string[] = list.body.data.map((u: { name: string }) => u.name);
    expect(names).toContain("Dana Reyes"); // Acme
    expect(names).toContain("Owen Park"); // Globex — other customer
    const owenId = await userId("owen.park@acme.com");
    await request(app)
      .patch(`${API}/users/${owenId}`)
      .set(bearer(sam))
      .send({ role: "admin" })
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
      .send({ status: "pending" })
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
      .send({ status: "pending" })
      .expect(200);

    const after = await request(app)
      .get(`${API}/tickets/1042/history`)
      .set(bearer(dana));
    expect(after.body.data).toHaveLength(n0 + 1);
    expect(after.body.data[0].toStatus).toBe("pending"); // newest first
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

  /**
   * A file exported from the old model — or from another help desk — carries a
   * status column, and `Open` is the value that model had. Refusing it names
   * what the statuses are; ignoring the column would import the row as New while
   * the reader believed the file's status had been honoured.
   */
  it("refuses a status the model retired, and says what the statuses are", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row({ status: "Open" })] });

    expect(res.status).toBe(400);
    const message = JSON.stringify(res.body);
    expect(message).toMatch(/New, Pending, Closed/);
    expect(message).toMatch(/always start as New/);
  });

  it("accepts a status column that names a real status, and still creates it as New", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row({ status: "Pending" })] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    // The importer files work; it does not decide where that work already got
    // to, so the column is validated and then ignored.
    const created = await prisma.ticket.findFirstOrThrow({
      orderBy: { id: "desc" },
    });
    expect(created.status).toBe("new");
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

  /**
   * Every rejection carries a machine-readable reason alongside its English
   * sentence. The client translates the code — echoing `error` straight to the
   * screen put an English sentence in the middle of a Thai page.
   */
  it("tags each rejection with a reason code the client can translate", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({
        rows: [
          row({ category: "Nonexistent" }),
          row({ requesterEmail: "ghost@acme.com" }),
          row({ requesterEmail: "priya.shah@acme.com" }), // another customer
          row(), // the control: this one succeeds
        ],
      });

    const results = res.body.data.results;
    expect(results[0]).toMatchObject({
      ok: false,
      field: "category",
      reason: "unknown_category",
    });
    // Both "no such address" and "not yours to file for" report the same reason,
    // for the same anti-probing purpose the shared wording serves.
    expect(results[1]).toMatchObject({
      ok: false,
      field: "requesterEmail",
      reason: "unknown_requester",
    });
    expect(results[2]).toMatchObject({
      ok: false,
      field: "requesterEmail",
      reason: "unknown_requester",
    });
    expect(results[3]).toMatchObject({ ok: true });
    expect(results[3].reason).toBeUndefined();

    // The prose stays for logs and API consumers with no dictionary to reach for.
    expect(typeof results[0].error).toBe("string");
    expect(results[0].error.length).toBeGreaterThan(0);
  });

  /**
   * The tenant boundary on the write path. `create` files a ticket under the
   * *requester's* customer, so a row naming an address outside the importer's own
   * customer used to write a ticket into someone else's tenant — counted as
   * created, then invisible in the importer's own list, because it sits behind a
   * scope they do not reach. Globex's users carry @acme.com addresses in the
   * seed, so nothing about the address warns you either.
   */
  const GLOBEX_REQUESTER = "priya.shah@acme.com";

  const globexTicketCount = () =>
    prisma.ticket.count({ where: { customer: { name: "Globex Inc" } } });

  it("refuses a requester in another customer, and files nothing there", async () => {
    const before = await globexTicketCount();
    const dana = await login("dana.reyes@acme.com"); // admin, Acme Corp
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(dana))
      .send({ rows: [row({ requesterEmail: GLOBEX_REQUESTER })] });

    expect(res.status).toBe(200); // nothing created → 200, not 201
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.results[0]).toMatchObject({
      ok: false,
      field: "requesterEmail",
    });
    expect(await globexTicketCount()).toBe(before);
  });

  it("says the same thing for a foreign requester as for one who does not exist", async () => {
    // Otherwise the import doubles as a directory probe: feed it addresses and
    // the wording tells you which ones exist inside other customers.
    const dana = await login("dana.reyes@acme.com");
    const send = (requesterEmail: string) =>
      request(app)
        .post(`${API}/tickets/import`)
        .set(bearer(dana))
        .send({ rows: [row({ requesterEmail })] });

    // Identical wording, differing only by the address that was asked about —
    // so the response says nothing about whether the user exists elsewhere.
    const foreign = await send(GLOBEX_REQUESTER);
    const missing = await send("ghost@acme.com");
    expect(foreign.body.data.results[0].error).toBe(
      `No user with email "${GLOBEX_REQUESTER}"`,
    );
    expect(missing.body.data.results[0].error).toBe(
      `No user with email "ghost@acme.com"`,
    );
    expect(foreign.body.data.results[0]).toMatchObject({
      ok: false,
      field: "requesterEmail",
    });
    expect(missing.body.data.results[0]).toMatchObject({
      ok: false,
      field: "requesterEmail",
    });
  });

  it("keys on reach, not on the role name", async () => {
    // Morgan Lee is a super_admin who belongs to Acme. The top role must not let
    // them out of their own customer.
    const morgan = await login("morgan.lee@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(morgan))
      .send({ rows: [row({ requesterEmail: GLOBEX_REQUESTER })] });
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.results[0]).toMatchObject({ field: "requesterEmail" });
  });

  it("lets a platform-wide super_admin import into any customer", async () => {
    // Sam Rivera has no customer of their own, which is what platform-wide reach
    // is keyed on — they legitimately serve every tenant.
    const sam = await login("sam.rivera@acme.com");
    const res = await request(app)
      .post(`${API}/tickets/import`)
      .set(bearer(sam))
      .send({ rows: [row({ requesterEmail: GLOBEX_REQUESTER })] });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    const created = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.results[0].ticketId },
      include: { customer: true },
    });
    expect(created.customer?.name).toBe("Globex Inc");
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
    expect(user.role).toBe("user");
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

  it("lets an admin read their own customer's entries", async () => {
    // `audit:read` reaches admin: someone working a case needs to see what
    // happened to a ticket before they picked it up. The tenant boundary is
    // unchanged — it is derived from the actor, not from the row.
    await makeCrossCustomerActivity();
    const dana = await login("dana.reyes@acme.com"); // admin, Acme
    const res = await request(app).get(ENDPOINT).set(bearer(dana));
    expect(res.status).toBe(200);
    expect(entityIds(res)).toContain(1042);
    expect(entityIds(res)).not.toContain(2001);
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

describe("knowledge base — authoring", () => {
  const AUTHOR = "dana.reyes@acme.com"; // admin: holds kb:write
  const READER = "marcus.chen@acme.com"; // user: read-only

  const draft = (over: Record<string, unknown> = {}) => ({
    title: "Reset a stuck print spooler",
    excerpt:
      "The spooler service wedges after a driver update and the queue stops moving.",
    body: "## Symptoms\n\n- Jobs pile up and never print\n\n## Fix\n\nRestart the spooler service, then clear the queue directory.",
    categoryId: 0, // replaced per-test with a real id
    tags: ["printer", "spooler"],
    readMin: 3,
    ...over,
  });

  /** Turn a ticket into a problem, so there is something to link an article to. */
  async function convert(token: string, ticketId: number, title: string) {
    const res = await request(app)
      .post(`${API}/tickets/${ticketId}/problem`)
      .set(bearer(token))
      .send({ title });
    expect(res.status).toBe(201);
    return res.body.data.id as number;
  }

  async function post(token: string, over: Record<string, unknown> = {}) {
    const body = draft(over);
    if (body.categoryId === 0) body.categoryId = await categoryId("Hardware");
    return request(app).post(`${API}/kb`).set(bearer(token)).send(body);
  }

  it("assigns the next id in the KB-nnn series", async () => {
    const token = await login(AUTHOR);
    const first = await post(token);
    expect(first.status).toBe(201);
    // The seeded library tops out at KB-118, so the next code continues from it
    // rather than restarting — support staff quote these ids at each other.
    expect(first.body.data.id).toBe("KB-119");
    const second = await post(token, { title: "A second new article" });
    expect(second.body.data.id).toBe("KB-120");
  });

  it("defaults a new article to draft, and hides it from readers", async () => {
    const token = await login(AUTHOR);
    const created = await post(token);
    expect(created.body.data.status).toBe("draft");
    const id = created.body.data.id as string;

    const reader = await login(READER);
    const hidden = await request(app)
      .get(`${API}/kb/${id}`)
      .set(bearer(reader));
    // 404, not 403: telling a reader the id is taken by something they may not
    // read is more than they need to know.
    expect(hidden.status).toBe(404);

    const list = await request(app).get(`${API}/kb`).set(bearer(reader));
    expect(list.body.data.map((a: { id: string }) => a.id)).not.toContain(id);

    const asAuthor = await request(app).get(`${API}/kb`).set(bearer(token));
    expect(asAuthor.body.data.map((a: { id: string }) => a.id)).toContain(id);
  });

  it("publishes with a status patch, and then everyone sees it", async () => {
    const token = await login(AUTHOR);
    const id = (await post(token)).body.data.id as string;

    const published = await request(app)
      .patch(`${API}/kb/${id}`)
      .set(bearer(token))
      .send({ status: "published" });
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("published");

    const reader = await login(READER);
    const visible = await request(app)
      .get(`${API}/kb/${id}`)
      .set(bearer(reader));
    expect(visible.status).toBe(200);
    expect(visible.body.data.title).toBe("Reset a stuck print spooler");
  });

  it("stamps who wrote it", async () => {
    const token = await login(AUTHOR);
    const created = await post(token);
    expect(created.body.data.author).toMatchObject({ name: "Dana Reyes" });
  });

  it("refuses a reader trying to write or delete their way in", async () => {
    const reader = await login(READER);
    const cat = await categoryId("Hardware");
    const create = await request(app)
      .post(`${API}/kb`)
      .set(bearer(reader))
      .send(draft({ categoryId: cat }));
    expect(create.status).toBe(403);

    const patch = await request(app)
      .patch(`${API}/kb/KB-042`)
      .set(bearer(reader))
      .send({ title: "Rewritten by a requester" });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .delete(`${API}/kb/KB-042`)
      .set(bearer(reader));
    expect(del.status).toBe(403);

    // And nothing changed.
    const after = await request(app).get(`${API}/kb/KB-042`).set(bearer(reader));
    expect(after.body.data.title).not.toBe("Rewritten by a requester");
  });

  it("normalises tags rather than rejecting a sloppy list", async () => {
    const token = await login(AUTHOR);
    const created = await post(token, {
      tags: ["Printer", "printer", "  SPOOLER ", ""],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.tags).toEqual(["printer", "spooler"]);
  });

  it("rejects a category that does not exist", async () => {
    const token = await login(AUTHOR);
    const res = await post(token, { categoryId: 99_999 });
    expect(res.status).toBe(400);
  });

  it("rejects an empty edit instead of writing nothing", async () => {
    const token = await login(AUTHOR);
    const res = await request(app)
      .patch(`${API}/kb/KB-042`)
      .set(bearer(token))
      .send({});
    expect(res.status).toBe(400);
  });

  it("404s an edit or delete of an id that never existed", async () => {
    const token = await login(AUTHOR);
    const patch = await request(app)
      .patch(`${API}/kb/KB-nope`)
      .set(bearer(token))
      .send({ readMin: 4 });
    expect(patch.status).toBe(404);
    const del = await request(app)
      .delete(`${API}/kb/KB-nope`)
      .set(bearer(token));
    expect(del.status).toBe(404);
  });

  it("finds an article by a phrase that only appears in its body", async () => {
    const token = await login(AUTHOR);
    await post(token, { status: "published" });
    // "queue directory" is in the body and in no title, excerpt or tag — the
    // search reaches the full text now that it lives in the database.
    const res = await request(app)
      .get(`${API}/kb?q=queue%20directory`)
      .set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { id: string }) => a.id)).toContain("KB-119");
  });

  it("lists only categories that have something in them", async () => {
    const reader = await login(READER);
    const res = await request(app).get(`${API}/kb`).set(bearer(reader));
    const categories: string[] = res.body.meta.categories;
    expect(categories.length).toBeGreaterThan(0);
    // Every category offered as a filter returns something — an empty filter
    // would be a dead end in the browse UI.
    for (const name of categories) {
      const filtered = await request(app)
        .get(`${API}/kb?category=${encodeURIComponent(name)}`)
        .set(bearer(reader));
      expect(filtered.body.data.length).toBeGreaterThan(0);
    }
  });

  it("writes an audit row for create, publish and delete", async () => {
    const token = await login(AUTHOR);
    const id = (await post(token)).body.data.id as string;
    await request(app)
      .patch(`${API}/kb/${id}`)
      .set(bearer(token))
      .send({ status: "published" });
    await request(app).delete(`${API}/kb/${id}`).set(bearer(token));

    const rows = await prisma.auditLog.findMany({
      where: { entity: "kb_article" },
      orderBy: { id: "asc" },
    });
    expect(rows.map((r) => r.action)).toEqual([
      "kb.create",
      "kb.update",
      "kb.delete",
    ]);
    // The id is a code, so it rides in meta — `audit_logs.entity_id` is an int.
    for (const row of rows) {
      expect((row.meta as { articleId: string }).articleId).toBe(id);
    }
    const publish = rows[1].meta as { statusFrom: string; statusTo: string };
    expect(publish.statusFrom).toBe("draft");
    expect(publish.statusTo).toBe("published");
  });

  it("leaves a problem loadable after its article is deleted", async () => {
    const token = await login(AUTHOR);
    const problem = await convert(token, 1042, "Outlives its article");
    const linked = await request(app)
      .patch(`${API}/problems/${problem}`)
      .set(bearer(token))
      .send({ kbArticleId: "KB-042" });
    expect(linked.status).toBe(200);
    expect(linked.body.data.kbArticle).toMatchObject({ id: "KB-042" });

    const del = await request(app)
      .delete(`${API}/kb/KB-042`)
      .set(bearer(token));
    expect(del.status).toBe(204);

    const after = await request(app)
      .get(`${API}/problems/${problem}`)
      .set(bearer(token));
    // The whole reason the reference is left soft: the problem still loads, and
    // says the link is now unavailable instead of 404-ing.
    expect(after.status).toBe(200);
    expect(after.body.data.kbArticleId).toBe("KB-042");
    expect(after.body.data.kbArticle).toBeNull();

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: "kb.delete" },
    });
    expect((row.meta as { orphanedProblems: number }).orphanedProblems).toBe(1);
  });

  it("still refuses to store a link to an article that does not exist", async () => {
    const token = await login(AUTHOR);
    const problem = await convert(token, 1042, "Bad link");
    const res = await request(app)
      .patch(`${API}/problems/${problem}`)
      .set(bearer(token))
      .send({ kbArticleId: "KB-not-a-thing" });
    expect(res.status).toBe(400);
  });

  it("suggests by the words of what a requester is typing", async () => {
    const reader = await login(READER);
    const res = await request(app)
      .get(`${API}/kb/suggest?q=${encodeURIComponent("my vpn keeps dropping")}`)
      .set(bearer(reader));
    expect(res.status).toBe(200);
    // KB-118 is tagged `vpn`; "vpn" is one of the typed words.
    expect(res.body.data.map((a: { id: string }) => a.id)).toContain("KB-118");
    expect(res.body.data.length).toBeLessThanOrEqual(3);
  });

  it("never offers a draft as a suggestion to a requester", async () => {
    const token = await login(AUTHOR);
    const id = (await post(token, { tags: ["printer"] })).body.data.id;
    const reader = await login(READER);
    const res = await request(app)
      .get(`${API}/kb/suggest?q=printer%20problem`)
      .set(bearer(reader));
    expect(res.body.data.map((a: { id: string }) => a.id)).not.toContain(id);
  });
});
