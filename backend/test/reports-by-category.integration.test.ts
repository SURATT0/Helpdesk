import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * What the SLA-by-category report groups by.
 *
 * A category belongs to one customer, so every tenant owns its own copy of the
 * starter set and the copies share a `code` — that is the whole reason the
 * column exists, and the root CLAUDE.md says a report groups by it. This report
 * grouped by the NAME instead, which is only the same answer for as long as
 * nobody renames anything.
 *
 * These are the two ways the two questions come apart: one code worn under two
 * names, and one name worn over two codes.
 */

const app = createApp();
const API = "/api/v1";

/** Platform-wide — belongs to no customer, so the report spans both tenants. */
const PLATFORM = "sam.rivera@acme.com";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

type CategoryRow = {
  code: string;
  category: string;
  judged: number;
  met: number;
  breached: number;
  compliancePct: number;
};

async function byCategory(): Promise<CategoryRow[]> {
  const res = await request(app)
    .get(`${API}/reports/sla-summary`)
    .set({ Authorization: `Bearer ${await login(PLATFORM)}` });
  expect(res.status).toBe(200);
  return res.body.data.byCategory as CategoryRow[];
}

/** A ticket that can be JUDGED: finished, with both a target and a finish time. */
async function judgedTicket(opts: {
  customerName: string;
  categoryCode: string;
  met: boolean;
}): Promise<void> {
  const customer = await prisma.customer.findFirstOrThrow({
    where: { name: opts.customerName },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { customerId: customer.id, code: opts.categoryCode },
  });
  const requester = await prisma.user.findFirstOrThrow({
    where: { customerId: customer.id, role: "user" },
  });
  const dueAt = new Date();
  await prisma.ticket.create({
    data: {
      subject: `judged ${opts.categoryCode} ${opts.met ? "met" : "breached"}`,
      description: "raised by reports-by-category",
      status: "closed",
      requesterId: requester.id,
      categoryId: category.id,
      customerId: customer.id,
      dueAt,
      // Judged is `resolvedAt <= dueAt`; an hour either side of the target is
      // what separates the two verdicts.
      resolvedAt: new Date(dueAt.getTime() + (opts.met ? -3_600_000 : 3_600_000)),
      closedAt: new Date(),
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("one code worn under two names", () => {
  it("keeps a renamed copy on the same line as the original", async () => {
    // Globex translates its copy. The code is untouched, because renaming is a
    // display decision — that is what the column is for.
    const globex = await prisma.customer.findFirstOrThrow({
      where: { name: "Globex Inc" },
    });
    await prisma.category.update({
      where: { customerId_code: { customerId: globex.id, code: "NETWORK" } },
      data: { name: "เครือข่าย" },
    });

    await judgedTicket({
      customerName: "Acme Corp",
      categoryCode: "NETWORK",
      met: true,
    });
    await judgedTicket({
      customerName: "Globex Inc",
      categoryCode: "NETWORK",
      met: false,
    });

    const rows = await byCategory();
    const network = rows.filter((r) => r.code === "NETWORK");
    expect(network).toHaveLength(1);
    // And the rename produced no second line of its own.
    expect(rows.some((r) => r.category === "เครือข่าย" && r.code !== "NETWORK")).toBe(
      false,
    );
    // Both tenants' tickets are counted on it: one met, one breached, so the
    // line has to have moved in both directions.
    expect(network[0].met).toBeGreaterThanOrEqual(1);
    expect(network[0].breached).toBeGreaterThanOrEqual(1);
    expect(network[0].judged).toBe(network[0].met + network[0].breached);
  });

  it("labels the line with a name rather than the code", async () => {
    await judgedTicket({
      customerName: "Acme Corp",
      categoryCode: "NETWORK",
      met: true,
    });
    const network = (await byCategory()).find((r) => r.code === "NETWORK");
    expect(network?.category).toBe("Network");
  });
});

describe("one name worn over two codes", () => {
  it("keeps them apart", async () => {
    // The names match and the codes do not — a tenant's copy whose code drifted.
    // Grouping by the name would have merged two unrelated buckets into one.
    const globex = await prisma.customer.findFirstOrThrow({
      where: { name: "Globex Inc" },
    });
    await prisma.category.update({
      where: { customerId_code: { customerId: globex.id, code: "SOFTWARE" } },
      data: { code: "SOFTWARE_LEGACY" },
    });

    await judgedTicket({
      customerName: "Acme Corp",
      categoryCode: "SOFTWARE",
      met: true,
    });
    await judgedTicket({
      customerName: "Globex Inc",
      categoryCode: "SOFTWARE_LEGACY",
      met: false,
    });

    const rows = await byCategory();
    const named = rows.filter((r) => r.category === "Software");
    expect(named.map((r) => r.code).sort()).toEqual([
      "SOFTWARE",
      "SOFTWARE_LEGACY",
    ]);
  });
});

describe("the order does not depend on what the query returned first", () => {
  it("answers the same table twice", async () => {
    // Several categories with ONE judged ticket each, so the busiest-first sort
    // is a tie the whole way down and only the tie-break decides the order.
    for (const code of ["NETWORK", "EMAIL", "HARDWARE", "ACCESS"]) {
      await judgedTicket({
        customerName: "Acme Corp",
        categoryCode: code,
        met: true,
      });
    }

    const first = (await byCategory()).map((r) => r.code);
    const second = (await byCategory()).map((r) => r.code);
    expect(first).toEqual(second);
    // And each code appears once: the grouping key is unique per row, which is
    // what lets the client key on it.
    expect(new Set(first).size).toBe(first.length);
  });
});
