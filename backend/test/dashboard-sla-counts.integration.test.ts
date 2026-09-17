import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * The dashboard's two SLA counts, and the line between them.
 *
 * They used to overlap. "Breaching within the hour" was `dueAt <= now + 1h`
 * with no floor, so it also held every ticket already past its target — one
 * overdue by a week was reported as breaching within the hour — while the
 * figure beside it excluded the past entirely. Nothing on the page answered
 * "how many have we already missed?", which is what somebody opens this card
 * to ask.
 *
 * So the rule under test is not just the arithmetic: it is that a ticket lands
 * in exactly ONE of the two, with `now` as the line.
 */

const app = createApp();
const API = "/api/v1";
const AGENT = "dana.reyes@acme.com";
const HOUR = 3_600_000;

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

async function slaCounts(): Promise<{ breached: number; dueSoon: number }> {
  const res = await request(app)
    .get(`${API}/dashboard/summary`)
    .set({ Authorization: `Bearer ${await login(AGENT)}` });
  expect(res.status).toBe(200);
  return {
    breached: res.body.data.stats.slaBreached as number,
    dueSoon: res.body.data.stats.slaDueSoon as number,
  };
}

/** An Acme ticket with a deadline, in whatever state the caller describes. */
async function makeTicket(data: {
  subject: string;
  status: "new" | "pending" | "closed" | "cancelled";
  dueInMs: number;
  resolvedAt?: Date | null;
}): Promise<void> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: "Acme Corp" },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { customerId: customer.id },
  });
  const requester = await prisma.user.findFirstOrThrow({
    where: { customerId: customer.id, role: "user" },
  });
  await prisma.ticket.create({
    data: {
      subject: data.subject,
      description: "raised by dashboard-sla-counts",
      status: data.status,
      requesterId: requester.id,
      categoryId: category.id,
      customerId: customer.id,
      dueAt: new Date(Date.now() + data.dueInMs),
      resolvedAt: data.resolvedAt ?? null,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("a ticket lands in one count or the other, never both", () => {
  it("counts an overdue ticket as breached and not as due soon", async () => {
    const before = await slaCounts();
    // A week past its target. The old reading called this "breaching within
    // the hour"; nothing called it missed.
    await makeTicket({
      subject: "overdue by a week",
      status: "new",
      dueInMs: -7 * 24 * HOUR,
    });
    const after = await slaCounts();
    expect(after.breached).toBe(before.breached + 1);
    expect(after.dueSoon).toBe(before.dueSoon);
  });

  it("counts a deadline half an hour away as due soon and not as breached", async () => {
    const before = await slaCounts();
    await makeTicket({
      subject: "thirty minutes left",
      status: "new",
      dueInMs: HOUR / 2,
    });
    const after = await slaCounts();
    expect(after.dueSoon).toBe(before.dueSoon + 1);
    expect(after.breached).toBe(before.breached);
  });

  it("counts a deadline three hours away as due soon", async () => {
    // Inside the four-hour window, past the one-hour tier the old figure used.
    const before = await slaCounts();
    await makeTicket({
      subject: "three hours left",
      status: "new",
      dueInMs: 3 * HOUR,
    });
    const after = await slaCounts();
    expect(after.dueSoon).toBe(before.dueSoon + 1);
    expect(after.breached).toBe(before.breached);
  });

  it("counts a deadline beyond the window as neither", async () => {
    const before = await slaCounts();
    await makeTicket({
      subject: "two days left",
      status: "new",
      dueInMs: 2 * 24 * HOUR,
    });
    expect(await slaCounts()).toEqual(before);
  });
});

describe("whose clock is still running", () => {
  it("ignores a ticket waiting on the requester, however overdue", async () => {
    // `pending` stamps `resolved_at` and the SLA resolution clock stops there —
    // the desk has finished, so there is no deadline left for it to miss.
    const before = await slaCounts();
    await makeTicket({
      subject: "finished, awaiting confirmation",
      status: "pending",
      dueInMs: -3 * 24 * HOUR,
      resolvedAt: new Date(),
    });
    expect(await slaCounts()).toEqual(before);
  });

  it("ignores a withdrawn ticket", async () => {
    // A target nobody was asked to hit was neither met nor missed.
    const before = await slaCounts();
    await makeTicket({
      subject: "withdrawn while overdue",
      status: "cancelled",
      dueInMs: -3 * 24 * HOUR,
    });
    expect(await slaCounts()).toEqual(before);
  });

  it("ignores a closed ticket", async () => {
    const before = await slaCounts();
    await makeTicket({
      subject: "closed late",
      status: "closed",
      dueInMs: -3 * 24 * HOUR,
      resolvedAt: new Date(),
    });
    expect(await slaCounts()).toEqual(before);
  });
});
