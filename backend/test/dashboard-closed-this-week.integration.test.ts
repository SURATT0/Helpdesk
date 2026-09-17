import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * What the dashboard's "closed this week" tile counts.
 *
 * Three states can look like a closure from the outside and are not one, and
 * each of them had a way of reaching this number:
 *
 *   pending    the desk finished the work and stamped `resolved_at`; the
 *              requester has not answered yet, so nobody has closed anything
 *   reopened   closed once, then reopened — it still carries the `closed_at` of
 *              that earlier closure, because the 30-day reopen check reads it
 *   cancelled  withdrawn, so no work and no closure at all
 *
 * The tile sits two cards away from "open tickets" and the status chart, so a
 * ticket counted in both places is a visible contradiction rather than a rounding
 * difference.
 */

const app = createApp();
const API = "/api/v1";
const AGENT = "dana.reyes@acme.com";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

async function closedThisWeek(): Promise<number> {
  const res = await request(app)
    .get(`${API}/dashboard/summary`)
    .set({ Authorization: `Bearer ${await login(AGENT)}` });
  expect(res.status).toBe(200);
  return res.body.data.stats.closedThisWeek as number;
}

/** A ticket in Acme, in whatever state the caller describes. */
async function makeTicket(data: {
  subject: string;
  status: "new" | "pending" | "closed" | "cancelled";
  resolvedAt?: Date | null;
  closedAt?: Date | null;
}): Promise<number> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: "Acme Corp" },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { customerId: customer.id },
  });
  const requester = await prisma.user.findFirstOrThrow({
    where: { customerId: customer.id, role: "user" },
  });
  const row = await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: "raised by dashboard-closed-this-week",
      status: data.status,
      requesterId: requester.id,
      categoryId: category.id,
      customerId: customer.id,
      resolvedAt: data.resolvedAt ?? null,
      closedAt: data.closedAt ?? null,
    },
  });
  return row.id;
}

beforeEach(async () => {
  await resetDb();
});

describe("the closed-this-week tile", () => {
  it("counts a ticket that is actually closed", async () => {
    const before = await closedThisWeek();
    await makeTicket({
      subject: "genuinely closed",
      status: "closed",
      resolvedAt: new Date(),
      closedAt: new Date(),
    });
    expect(await closedThisWeek()).toBe(before + 1);
  });

  it("does not count finished work the requester has not answered", async () => {
    // `pending` stamps `resolved_at`, which is what the tile used to read. The
    // desk is done; nobody has closed anything.
    const before = await closedThisWeek();
    await makeTicket({
      subject: "waiting on the requester",
      status: "pending",
      resolvedAt: new Date(),
    });
    expect(await closedThisWeek()).toBe(before);
  });

  it("does not count a reopened ticket still carrying its old closure", async () => {
    // `closed_at` is never cleared — the 30-day reopen window is measured from
    // it — so the status is what says whether the ticket is closed NOW.
    const before = await closedThisWeek();
    await makeTicket({
      subject: "closed on Monday, reopened on Tuesday",
      status: "new",
      resolvedAt: new Date(),
      closedAt: new Date(),
    });
    expect(await closedThisWeek()).toBe(before);
  });

  it("does not count a withdrawn ticket", async () => {
    // Belt and braces: a cancellation leaves both timestamps null, so this
    // cannot be counted by any reading of the columns. Pinned anyway, because
    // "cancelled is not a flavour of closed" is the rule the column relies on.
    const before = await closedThisWeek();
    await makeTicket({ subject: "withdrawn", status: "cancelled" });
    expect(await closedThisWeek()).toBe(before);
  });

  it("does not count a closure older than the window", async () => {
    const before = await closedThisWeek();
    const longAgo = new Date(Date.now() - 30 * 24 * 3_600_000);
    await makeTicket({
      subject: "closed last month",
      status: "closed",
      resolvedAt: longAgo,
      closedAt: longAgo,
    });
    expect(await closedThisWeek()).toBe(before);
  });

  it("moves with the closure trend the reports page draws", async () => {
    // The two surfaces answer the same question and used to read different
    // columns. Compared as DELTAS rather than totals: the trend buckets seven
    // CALENDAR days from midnight while this tile counts a rolling 7×24h, so
    // their absolute figures can legitimately differ on a seeded database.
    // What must not differ is what either of them calls a closure.
    const trendTotal = async (): Promise<number> => {
      const res = await request(app)
        .get(`${API}/reports/sla-summary`)
        .set({ Authorization: `Bearer ${await login(AGENT)}` });
      expect(res.status).toBe(200);
      return (res.body.data.closureTrend as { count: number }[]).reduce(
        (a, b) => a + b.count,
        0,
      );
    };

    const tileBefore = await closedThisWeek();
    const trendBefore = await trendTotal();

    await makeTicket({
      subject: "closed today",
      status: "closed",
      resolvedAt: new Date(),
      closedAt: new Date(),
    });
    // Finished, not closed. Neither side may count it.
    await makeTicket({
      subject: "pending today",
      status: "pending",
      resolvedAt: new Date(),
    });

    expect(await closedThisWeek()).toBe(tileBefore + 1);
    expect(await trendTotal()).toBe(trendBefore + 1);
  });
});
