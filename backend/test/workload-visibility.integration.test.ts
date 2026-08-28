import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Who may see how much work someone else is carrying.
 *
 * The rule: per-person workload figures are for super admins; your own are
 * always your own. What makes this worth a suite of its own is that the figure
 * leaks in more ways than the one report it is named after — a filtered list
 * reports a count, an audit query reports a total — so every route that can be
 * pointed at one person is checked here, not just the obvious one.
 *
 * Each test asserts on the RESPONSE BODY as well as the status, because a 403
 * that still serialised the rows would pass a status-only check.
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

async function userId(email: string): Promise<number> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return u.id;
}

/**
 * Every key name anywhere in a payload, however deeply nested.
 *
 * The sweep at the bottom needs to prove a field is ABSENT, and "absent" has to
 * mean absent from the whole document — a per-agent block tucked inside `meta`
 * would satisfy a top-level check while still being on the wire.
 */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, into);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

const AGENT = "dana.reyes@acme.com"; // admin — what the UI calls an agent
const SUPERUSER = "morgan.lee@acme.com"; // super_admin inside Acme
const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer of their own
const REQUESTER = "marcus.chen@acme.com"; // user
const OTHER_AGENT = "ana.m@acme.com";

beforeEach(async () => {
  await resetDb();
});

describe("GET /reports/workload/agents — the comparison table", () => {
  it("gives a super admin the whole desk", async () => {
    const token = await login(SUPERUSER);
    const res = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(1);
    // More than one person is the whole point — this is the comparison view.
    const names = res.body.data.map((r: { agent: string }) => r.agent);
    expect(new Set(names).size).toBeGreaterThan(1);
    for (const row of res.body.data) {
      expect(row).toMatchObject({
        agentId: expect.any(Number),
        agent: expect.any(String),
        handled: expect.any(Number),
        avgHandlingHours: expect.any(Number),
      });
    }
  });

  it("refuses an agent, and sends no rows with the refusal", async () => {
    const token = await login(AGENT);
    const res = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(token));

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
    // Not merely "no data key": nothing anywhere in the body may name a person
    // or carry a figure about one.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Dana Reyes");
    expect(body).not.toContain("Ana M.");
    expect(body).not.toContain("handled");
    expect(body).not.toContain("avgHandlingHours");
  });

  it("refuses a requester too", async () => {
    const token = await login(REQUESTER);
    const res = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  it("keeps a customer's super admin inside their own tenant", async () => {
    // The gate is the role; row scope is still what decides WHOSE numbers those
    // are. Morgan runs Acme's desk, so Globex staff must not appear in it.
    const token = await login(SUPERUSER);
    const res = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    const names: string[] = res.body.data.map((r: { agent: string }) => r.agent);
    expect(names).not.toContain("Owen Park"); // Globex
    expect(names).not.toContain("Nadia Kofi"); // Globex

    // And the platform-wide super admin, who has no customer, does reach across.
    const platform = await login(PLATFORM);
    const all = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(platform));
    expect(all.status).toBe(200);
    const everyone: string[] = all.body.data.map(
      (r: { agent: string }) => r.agent,
    );
    expect(everyone.length).toBeGreaterThanOrEqual(names.length);
  });
});

describe("GET /reports/workload — one person", () => {
  it("lets an agent read their own figures by id", async () => {
    const token = await login(AGENT);
    const me = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/reports/workload?assigneeId=${me}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      agentId: me,
      agent: "Dana Reyes",
      handled: expect.any(Number),
    });
  });

  it("refuses an agent asking for a colleague", async () => {
    const token = await login(AGENT);
    const other = await userId(OTHER_AGENT);
    const res = await request(app)
      .get(`${API}/reports/workload?assigneeId=${other}`)
      .set(bearer(token));

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Ana M.");
  });

  it("answers with the caller alone when no assignee is named", async () => {
    const token = await login(AGENT);
    const me = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/reports/workload`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    // One person, and that person is the caller — never the team.
    expect(Array.isArray(res.body.data)).toBe(false);
    expect(res.body.data?.agentId).toBe(me);
  });

  it("lets a super admin read anyone", async () => {
    const token = await login(SUPERUSER);
    const dana = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/reports/workload?assigneeId=${dana}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.agentId).toBe(dana);
  });

  it("reports the same numbers to the agent and to the super admin", async () => {
    // The self-exception must not become a second, kinder measurement: what an
    // agent reads about themselves has to be the row their manager sees.
    const dana = await userId(AGENT);
    const own = await request(app)
      .get(`${API}/reports/workload?assigneeId=${dana}`)
      .set(bearer(await login(AGENT)));
    const table = await request(app)
      .get(`${API}/reports/workload/agents`)
      .set(bearer(await login(SUPERUSER)));

    const fromTable = table.body.data.find(
      (r: { agentId: number }) => r.agentId === dana,
    );
    expect(own.body.data).toEqual(fromTable);
  });
});

describe("GET /reports/sla-summary — no longer carries per-agent rows", () => {
  it("has no byAgent field for anyone, super admin included", async () => {
    for (const email of [AGENT, SUPERUSER, REQUESTER]) {
      const res = await request(app)
        .get(`${API}/reports/sla-summary`)
        .set(bearer(await login(email)));

      expect(res.status).toBe(200);
      expect(res.body.data.byAgent).toBeUndefined();
      const keys = allKeys(res.body);
      expect(keys.has("byAgent")).toBe(false);
      expect(keys.has("agent")).toBe(false);
      expect(keys.has("handled")).toBe(false);
    }
  });

  it("still answers the team-wide questions it is for", async () => {
    const res = await request(app)
      .get(`${API}/reports/sla-summary`)
      .set(bearer(await login(AGENT)));

    expect(res.status).toBe(200);
    // The metrics that were never in scope must survive untouched.
    expect(res.body.data.kpis).toMatchObject({
      avgHandlingHours: expect.any(Number),
      medianFirstResponseMin: expect.any(Number),
      slaCompliancePct: expect.any(Number),
    });
    expect(res.body.data.byPriority.length).toBe(4);
    expect(res.body.data.closureTrend.length).toBe(7);
    expect(res.body.data.byCategory.length).toBeGreaterThan(0);
  });
});

describe("indirect channels", () => {
  it("refuses a ticket list filtered to someone else's queue", async () => {
    const token = await login(AGENT);
    const other = await userId(OTHER_AGENT);
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=${other}`)
      .set(bearer(token));

    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
    // The count is the leak, so the refusal must carry no total either.
    expect(res.body.meta).toBeUndefined();
  });

  it("allows an agent to filter to their own queue", async () => {
    const token = await login(AGENT);
    const me = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=${me}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const t of res.body.data) expect(t.assigneeId).toBe(me);
  });

  it("keeps the unassigned queue open — it is nobody's workload", async () => {
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=none`)
      .set(bearer(await login(AGENT)));

    expect(res.status).toBe(200);
    for (const t of res.body.data) expect(t.assigneeId).toBeNull();
  });

  it("lets a super admin filter to anyone", async () => {
    const dana = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/tickets?assigneeId=${dana}`)
      .set(bearer(await login(SUPERUSER)));
    expect(res.status).toBe(200);
  });

  it("refuses an audit trail filtered to another person's actions", async () => {
    const token = await login(AGENT);
    const other = await userId(OTHER_AGENT);
    const res = await request(app)
      .get(`${API}/audit?userId=${other}&action=ticket`)
      .set(bearer(token));

    expect(res.status).toBe(403);
    // `meta.total` is the per-person counter this closes.
    expect(res.body.meta).toBeUndefined();
  });

  it("allows an agent to filter the trail to their own actions", async () => {
    const token = await login(AGENT);
    const me = await userId(AGENT);
    const res = await request(app)
      .get(`${API}/audit?userId=${me}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toEqual(expect.any(Number));
  });
});

describe("payload sweep — every page an agent can open", () => {
  /**
   * The catch-all: no route an agent reaches may carry a per-person aggregate.
   *
   * What counts as one is a SHAPE, not a key name, and getting that distinction
   * right is the whole value of this test. `kpis.avgHandlingHours` is the team's
   * average and must survive — it was never in scope. `assignee` on a ticket row
   * is a property of a ticket the agent may already read. The forbidden thing is
   * the two of them in ONE object: an identity paired with a figure about that
   * identity, which is what ranks people against each other.
   *
   * A blunter check on the key name alone fails on the team KPI, and "fixing" it
   * by deleting the KPI would silently discard a metric this work must not touch.
   */
  const IDENTITY = ["agent", "agentId", "assignee", "assigneeName"];
  const FIGURE = ["handled", "avgHandlingHours", "count", "total"];

  /** Objects that pair someone's identity with a number about them. */
  function rankingRows(value: unknown, path = "$", found: string[] = []) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => rankingRows(v, `${path}[${i}]`, found));
    } else if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.some((k) => IDENTITY.includes(k)) && keys.some((k) => FIGURE.includes(k))) {
        found.push(`${path} {${keys.join(", ")}}`);
      }
      for (const [k, v] of Object.entries(value)) rankingRows(v, `${path}.${k}`, found);
    }
    return found;
  }

  it("carries no per-person aggregate on any of them", async () => {
    const token = await login(AGENT);
    const routes = [
      "/dashboard/summary",
      "/reports/sla-summary",
      "/tickets",
      "/tickets/closed?granularity=all&limit=50&offset=0",
      "/users",
      "/audit?limit=50&offset=0",
      "/projects",
      "/notifications",
    ];

    for (const route of routes) {
      const res = await request(app).get(`${API}${route}`).set(bearer(token));
      expect(res.status, route).toBe(200);

      const keys = allKeys(res.body);
      // These name a person's throughput and nothing else, so they are banned
      // outright wherever they appear.
      for (const field of ["byAgent", "agentId", "handled"]) {
        expect(keys.has(field), `${route} leaked "${field}"`).toBe(false);
      }
      expect(rankingRows(res.body), `${route} carries a ranking row`).toEqual([]);
    }
  });

  it("proves the sweep can actually fail", async () => {
    // A guard on the guard: the shape check above is only worth anything if it
    // catches the payload this change removed. This is that payload.
    const oldShape = {
      data: { byAgent: [{ agent: "Dana Reyes", handled: 9, avgHandlingHours: 38.9 }] },
    };
    expect(rankingRows(oldShape)).toHaveLength(1);
    // …and it does not fire on the team-wide KPI that must survive.
    expect(rankingRows({ data: { kpis: { avgHandlingHours: 56.1 } } })).toEqual([]);
  });
});
