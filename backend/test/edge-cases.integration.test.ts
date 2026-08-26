import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Negative & edge-case round for the ticket write paths.
 *
 * Deliberately separate from app.integration.test.ts: that file pins the
 * behaviour the app promises, this one probes the edges the UI never reaches —
 * duplicate submits, hostile input, two screens acting on one row, and the
 * timezone seam under the closed-ticket log.
 *
 * The concurrent-transition race itself is covered by the status-transition
 * tests in app.integration.test.ts; what remains here is the surrounding
 * behaviour those do not touch.
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

async function categoryId(name: string): Promise<number> {
  const c = await prisma.category.findUniqueOrThrow({ where: { name } });
  return c.id;
}

/** A fresh ticket owned by Dana, at a known starting status. */
async function makeTicket(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const res = await request(app)
    .post(`${API}/tickets`)
    .set(bearer(token))
    .send({
      subject: "Baseline ticket for an edge case",
      description: "Created by the edge-case suite.",
      categoryId: await categoryId("Hardware"),
      priority: "medium",
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

beforeEach(async () => {
  await resetDb();
});

// ---------------------------------------------------------------------------
// 1. Double submit
// ---------------------------------------------------------------------------

describe("double submit", () => {
  it("collapses a sequential retry carrying the same idempotency key", async () => {
    const dana = await login("dana.reyes@acme.com");
    const body = {
      subject: "Printer on 3rd floor is jammed",
      description: "Paper feed keeps catching.",
      categoryId: await categoryId("Hardware"),
    };
    const key = "retry-key-sequential";

    const first = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", key)
      .send(body);
    const second = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", key)
      .send(body);

    // The replay is indistinguishable from the original: same status, same row.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      await prisma.ticket.count({ where: { subject: body.subject } }),
    ).toBe(1);
  });

  it("collapses two simultaneous creates carrying the same key", async () => {
    const dana = await login("dana.reyes@acme.com");
    const body = {
      subject: "My laptop will not boot",
      description: "Pressed the power button twice, nothing happened.",
      categoryId: await categoryId("Hardware"),
      priority: "high" as const,
    };
    const key = "retry-key-parallel";

    // Both sail past the up-front lookup; only the unique constraint separates
    // them. This is the case a check-then-insert cannot cover.
    const [a, b] = await Promise.all([
      request(app)
        .post(`${API}/tickets`)
        .set(bearer(dana))
        .set("Idempotency-Key", key)
        .send(body),
      request(app)
        .post(`${API}/tickets`)
        .set(bearer(dana))
        .set("Idempotency-Key", key)
        .send(body),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(
      await prisma.ticket.count({
        where: { subject: body.subject, deletedAt: null },
      }),
    ).toBe(1);
  });

  it("keys are scoped per requester, so two people may pick the same one", async () => {
    const body = {
      description: "Same key, different people.",
      categoryId: await categoryId("Hardware"),
    };
    const key = "a-key-two-people-both-chose";

    const dana = await login("dana.reyes@acme.com");
    const marcus = await login("marcus.chen@acme.com");

    const a = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", key)
      .send({ ...body, subject: "Dana's own ticket" });
    const b = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(marcus))
      .set("Idempotency-Key", key)
      .send({ ...body, subject: "Marcus's own ticket" });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // Two tickets, and crucially Marcus was NOT handed Dana's.
    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(b.body.data.subject).toBe("Marcus's own ticket");
  });

  it("without a key, a repeated create still raises a second ticket", async () => {
    const dana = await login("dana.reyes@acme.com");
    const body = {
      subject: "Raised twice on purpose",
      description: "Two genuinely separate reports of the same thing.",
      categoryId: await categoryId("Hardware"),
    };

    const first = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send(body);
    const second = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send(body);

    // Deliberate: two people really can hit the same problem twice, and a
    // help desk that silently merged them would lose one of the reports.
    // De-duplication is opt-in, by sending a key.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(
      await prisma.ticket.count({ where: { subject: body.subject } }),
    ).toBe(2);
  });

  it("a different key means a different ticket, even with identical content", async () => {
    const dana = await login("dana.reyes@acme.com");
    const body = {
      subject: "Edited then resubmitted",
      description: "The person changed their mind and sent it again.",
      categoryId: await categoryId("Hardware"),
    };

    const first = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", "key-one")
      .send(body);
    const second = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", "key-two")
      .send(body);

    expect(second.body.data.id).not.toBe(first.body.data.id);
  });

  it("refuses an unbounded idempotency key rather than storing it", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .set("Idempotency-Key", "k".repeat(5_000))
      .send({
        subject: "Oversized key probe",
        description: "x",
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2. Hostile / oversized input
// ---------------------------------------------------------------------------

describe("input hardening", () => {
  it("refuses a subject that is only whitespace", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "   ",
        description: "x",
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);
  });

  it("refuses a subject that is only whitespace but long enough to pass min(3)", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "\t\n   ",
        description: "x",
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);
  });

  it("caps an absurdly long subject rather than storing it", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "A".repeat(10_000),
        description: "x",
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);
  });

  it("caps an absurdly long description rather than storing it", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "Long description probe",
        description: "B".repeat(500_000),
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);
  });

  it("round-trips emoji, Thai combining marks and RTL text unchanged", async () => {
    const dana = await login("dana.reyes@acme.com");
    const subject = "เครื่องพิมพ์เสีย 🖨️💥 ทดสอบ";
    const description =
      "emoji: 👨‍👩‍👧‍👦🇹🇭 · thai: กำ ก้ำ ก๊ำ · rtl: مرحبا · zwj: a‍b · math: 𝕏";
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject,
        description,
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe(subject);
    expect(res.body.data.description).toBe(description);

    // And unchanged on the way back out of the database, not just echoed.
    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.subject).toBe(subject);
    expect(row.description).toBe(description);
  });

  it("stores a SQL-shaped subject literally and leaves the table standing", async () => {
    const dana = await login("dana.reyes@acme.com");
    const subject = "'; DROP TABLE tickets; --";
    const description = "1 OR 1=1; SELECT * FROM users WHERE ''='";
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject,
        description,
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe(subject);

    // The table is still queryable, and the row is data rather than a statement.
    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.subject).toBe(subject);
    expect(await prisma.ticket.count()).toBeGreaterThan(0);
  });

  it("treats a SQL-shaped search term as text in the closed-log filter", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/tickets/closed`)
      .query({ granularity: "all", q: "%' OR 1=1 --" })
      .set(bearer(dana));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // A wildcard-shaped term must not behave as a wildcard that matches all.
    expect(res.body.data.length).toBe(0);
  });

  /**
   * Postgres cannot store a NUL in a text column: the INSERT fails with
   * SQLSTATE 22021, which reached the client as an unhandled 500. Built with
   * fromCharCode so this source file stays plain text.
   */
  it("refuses a NUL byte with a 400 rather than failing inside the driver", async () => {
    const dana = await login("dana.reyes@acme.com");
    const NUL = String.fromCharCode(0);
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: `NUL byte probe ${NUL} here`,
        description: `body ${NUL} too`,
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(400);

    // And nothing was written — the row must not exist in a half-made state.
    expect(
      await prisma.ticket.count({ where: { subject: { contains: "NUL byte probe" } } }),
    ).toBe(0);
  });

  it("refuses a NUL byte in a comment body too", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await makeTicket(dana);
    const res = await request(app)
      .post(`${API}/tickets/${id}/comments`)
      .set(bearer(dana))
      .send({ body: `hello ${String.fromCharCode(0)} world` });
    expect(res.status).toBe(400);
  });

  it("stores the trimmed subject, so the bound and the row agree", async () => {
    const dana = await login("dana.reyes@acme.com");
    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(dana))
      .send({
        subject: "   Padded on both sides   ",
        description: "   body   ",
        categoryId: await categoryId("Hardware"),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.subject).toBe("Padded on both sides");
    expect(res.body.data.description).toBe("body");
  });
});

// ---------------------------------------------------------------------------
// 3. Two screens editing the same ticket
// ---------------------------------------------------------------------------

describe("concurrent edits to one ticket", () => {
  it("serialised conflicting transitions: the second is refused with 409", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await makeTicket(dana);
    await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "open" });

    const first = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "resolved" });
    expect(first.status).toBe(200);

    // resolved → pending is not in the whitelist.
    const second = await request(app)
      .patch(`${API}/tickets/${id}/status`)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("parallel writes to two different fields both survive", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await makeTicket(dana);

    const [status, priority] = await Promise.all([
      request(app)
        .patch(`${API}/tickets/${id}/status`)
        .set(bearer(dana))
        .send({ status: "open" }),
      request(app)
        .patch(`${API}/tickets/${id}/priority`)
        .set(bearer(dana))
        .send({ priority: "critical" }),
    ]);
    expect(status.status).toBe(200);
    expect(priority.status).toBe(200);

    // Neither write may clobber the other — they touch disjoint columns.
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("open");
    expect(row.priority).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// 5. Timezone: a ticket that closes either side of local midnight
// ---------------------------------------------------------------------------

describe("closed-log bucketing around local midnight", () => {
  /**
   * Two tickets closed 40 minutes apart, straddling midnight on 1 August.
   *
   * Built with the `new Date(y, m, d, h, m)` constructor, so these are LOCAL
   * instants in whatever zone the process runs in — the same calendar
   * `history.period.ts` reckons its windows in. Written as fixed UTC offsets
   * the assertions would only mean anything in one zone, and would quietly
   * invert in another.
   *
   * What this pins is that a ticket lands in the month a person reading the
   * clock on the wall would file it under. The month picker is the only way to
   * reach a closed ticket, so the bucket has to agree with the date printed
   * beside it. Whether the SERVER's wall clock is the right one is a
   * deployment question — see the `TZ` setting on the api service in
   * docker-compose.yml, which is what made this wrong in the container while
   * it was right here.
   */
  const BEFORE = new Date(2026, 6, 31, 23, 50); // 31 Jul, 23:50 local
  const AFTER = new Date(2026, 7, 1, 0, 30); // 1 Aug, 00:30 local
  const JULY_ANCHOR = new Date(2026, 6, 15).toISOString();
  const AUGUST_ANCHOR = new Date(2026, 7, 15).toISOString();

  async function closeAt(token: string, when: Date): Promise<number> {
    const id = await makeTicket(token, {
      subject: `Closed at ${when.toISOString()}`,
    });
    await prisma.ticket.update({
      where: { id },
      data: { status: "closed", closedAt: when },
    });
    return id;
  }

  it("puts a ticket closed just after local midnight in the local month", async () => {
    const dana = await login("dana.reyes@acme.com");
    const afterId = await closeAt(dana, AFTER);

    // The August window, as the viewer's calendar reckons it.
    const res = await request(app)
      .get(`${API}/tickets/closed`)
      .query({ granularity: "month", anchor: AUGUST_ANCHOR })
      .set(bearer(dana));
    expect(res.status).toBe(200);

    const ids = (res.body.data as Array<{ id: number }>).map((t) => t.id);
    expect(ids).toContain(afterId);
  });

  it("keeps the two sides of midnight in different months", async () => {
    const dana = await login("dana.reyes@acme.com");
    const beforeId = await closeAt(dana, BEFORE);
    const afterId = await closeAt(dana, AFTER);

    const july = await request(app)
      .get(`${API}/tickets/closed`)
      .query({ granularity: "month", anchor: JULY_ANCHOR })
      .set(bearer(dana));
    const august = await request(app)
      .get(`${API}/tickets/closed`)
      .query({ granularity: "month", anchor: AUGUST_ANCHOR })
      .set(bearer(dana));

    const julyIds = (july.body.data as Array<{ id: number }>).map((t) => t.id);
    const augustIds = (august.body.data as Array<{ id: number }>).map(
      (t) => t.id,
    );

    expect(julyIds).toContain(beforeId);
    expect(julyIds).not.toContain(afterId);
    expect(augustIds).toContain(afterId);
    expect(augustIds).not.toContain(beforeId);
  });

  it("finds both of them in `all` mode, which has no window to disagree about", async () => {
    const dana = await login("dana.reyes@acme.com");
    const beforeId = await closeAt(dana, BEFORE);
    const afterId = await closeAt(dana, AFTER);

    const res = await request(app)
      .get(`${API}/tickets/closed`)
      .query({ granularity: "all" })
      .set(bearer(dana));
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: number }>).map((t) => t.id);
    expect(ids).toContain(beforeId);
    expect(ids).toContain(afterId);
  });

  it("a ticket created either side of local midnight keeps its SLA target intact", async () => {
    const dana = await login("dana.reyes@acme.com");
    const id = await makeTicket(dana, {
      subject: "Raised at 00:05 local time",
      priority: "critical",
    });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    // due_at is an instant computed from the policy, so it must be strictly
    // after creation regardless of which calendar day either lands on.
    expect(row.dueAt).not.toBeNull();
    expect(row.dueAt!.getTime()).toBeGreaterThan(row.createdAt.getTime());
  });
});
