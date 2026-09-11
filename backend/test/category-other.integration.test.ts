import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { OTHER_CATEGORY_CODE } from "../src/shared/category-other";
import { prisma, resetDb } from "./db";

/**
 * "Other (please describe)", from the API's side.
 *
 * The rule itself is proved in `src/shared/category-other.test.ts`. What only
 * this file can answer is whether it is actually REACHED — the check lives in
 * the ticket repository rather than the ticket service precisely because three
 * separate paths write tickets, and a check in the service would have covered
 * one of them.
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

/** Acme's copy of the Other category, and of an ordinary one. */
async function categories() {
  const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  const other = await prisma.category.findFirstOrThrow({
    where: { customerId: acme.id, code: OTHER_CATEGORY_CODE },
  });
  const network = await prisma.category.findFirstOrThrow({
    where: { customerId: acme.id, code: "NETWORK" },
  });
  return { acme, other, network };
}

const draft = (categoryId: number, extra: Record<string, unknown> = {}) => ({
  subject: "Something odd is happening",
  description: "Raised by the category-other suite.",
  categoryId,
  priority: "low",
  ...extra,
});

beforeEach(async () => {
  await resetDb();
});

describe("every customer has the option to begin with", () => {
  it("gives each tenant its own Other row, carrying the same code", async () => {
    const rows = await prisma.category.findMany({
      where: { code: OTHER_CATEGORY_CODE },
      select: { customerId: true },
    });
    const customers = await prisma.customer.findMany({ select: { id: true } });
    // One per customer, not one shared row: that is how every category works
    // since they stopped being shared, and it is what lets a tenant rename or
    // translate theirs without moving anybody else's.
    expect(rows.map((r) => r.customerId).sort()).toEqual(
      customers.map((c) => c.id).sort(),
    );
  });
});

describe("filing under Other", () => {
  it("is refused with nothing written down, and says which field", async () => {
    const { other } = await categories();
    const token = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(other.id));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CATEGORY_DETAIL_REQUIRED");
    // The field, so the form can point at the control rather than printing a
    // sentence above it; the reason, so the client can word the two cases apart.
    expect(res.body.error.details).toEqual({
      field: "categoryOther",
      reason: "missing",
    });
  });

  it("is refused for whitespace, with the same answer rather than a field-length one", async () => {
    const { other } = await categories();
    const token = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(other.id, { categoryOther: "   " }));

    // NOT a VALIDATION_ERROR. The zod schema deliberately sets `min: 0` so a
    // blank reaches the one rule that decides this instead of being turned away
    // at the door with a message about a string length.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CATEGORY_DETAIL_REQUIRED");
  });

  it("succeeds with a description, and keeps the words rather than the typing", async () => {
    const { other } = await categories();
    const token = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(other.id, { categoryOther: "  เครื่องพิมพ์กระดาษติด  " }));

    expect(res.status).toBe(201);
    expect(res.body.data.categoryOther).toBe("เครื่องพิมพ์กระดาษติด");
    // The code travels with the ticket so a reader can tell WHICH option this
    // was without matching on a name a tenant may have translated.
    expect(res.body.data.categoryCode).toBe(OTHER_CATEGORY_CODE);

    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.categoryOther).toBe("เครื่องพิมพ์กระดาษติด");
    // And no category row was invented for it. That is the whole reason the
    // text lives on the ticket: "เน็ตช้า" and "เน็ทช้า" must not become two
    // categories that mean one thing.
    expect(
      await prisma.category.count({ where: { name: "เครื่องพิมพ์กระดาษติด" } }),
    ).toBe(0);
  });
});

describe("filing under anything else", () => {
  it("refuses a description rather than dropping it silently", async () => {
    const { network } = await categories();
    const token = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(network.id, { categoryOther: "this does not belong here" }));

    expect(res.status).toBe(400);
    expect(res.body.error.details.reason).toBe("not_applicable");
  });

  it("is unaffected otherwise, and reads back with a null description", async () => {
    const { network } = await categories();
    const token = await login("marcus.chen@acme.com");

    const res = await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(network.id));

    expect(res.status).toBe(201);
    expect(res.body.data.categoryOther).toBeNull();
  });
});

describe("tickets raised before any of this existed", () => {
  it("still open, and read back with no description", async () => {
    // The migration backfilled nothing, deliberately: a ticket filed under a
    // real category has nothing to describe, and one filed before the option
    // existed was never asked. Inventing text for either would be making up a
    // person's words.
    const seeded = await prisma.ticket.findFirstOrThrow({
      where: { deletedAt: null },
      orderBy: { id: "asc" },
    });
    expect(seeded.categoryOther).toBeNull();

    const token = await login("dana.reyes@acme.com");
    const res = await request(app)
      .get(`${API}/tickets/${seeded.id}`)
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.data.categoryOther).toBeNull();
    expect(res.body.data.category).toBeTruthy();
  });
});

describe("promoting a description into a category", () => {
  /** Raise a ticket under Other with the given text. */
  async function fileUnderOther(text: string): Promise<void> {
    const { other } = await categories();
    const token = await login("marcus.chen@acme.com");
    await request(app)
      .post(`${API}/tickets`)
      .set(bearer(token))
      .send(draft(other.id, { categoryOther: text }))
      .expect(201);
  }

  it("is refused to an agent, both reading the list and creating", async () => {
    const dana = await login("dana.reyes@acme.com"); // admin
    const { acme } = await categories();

    await request(app)
      .get(`${API}/categories/other-descriptions`)
      .set(bearer(dana))
      .expect(403);

    await request(app)
      .post(`${API}/categories`)
      .set(bearer(dana))
      .send({ name: "Sneaky", customerId: acme.id })
      .expect(403);
  });

  it("groups what people typed, case- and space-insensitively", async () => {
    await fileUnderOther("Printer jams");
    await fileUnderOther("printer  jams");
    await fileUnderOther("VPN drops");

    const sam = await login("sam.rivera@acme.com"); // platform-wide super admin
    const res = await request(app)
      .get(`${API}/categories/other-descriptions`)
      .set(bearer(sam));

    expect(res.status).toBe(200);
    const jams = res.body.data.find((d: { count: number }) => d.count === 2);
    // Two spellings of one theme are one row — three rows here would mean the
    // page cannot show anybody that this keeps coming up, which is its point.
    expect(jams).toBeDefined();
    expect(jams.text.toLowerCase()).toContain("printer");
    expect(jams.ticketIds).toHaveLength(2);
    expect(res.body.data.map((d: { count: number }) => d.count)).toContain(1);
  });

  it("creates the category for that customer, and leaves the old tickets alone", async () => {
    await fileUnderOther("Printer jams");
    const { acme, other } = await categories();
    const before = await prisma.ticket.findFirstOrThrow({
      where: { categoryOther: "Printer jams" },
    });

    const sam = await login("sam.rivera@acme.com");
    const res = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "Printer jams", customerId: acme.id });

    expect(res.status).toBe(201);
    expect(res.body.data.customerId).toBe(acme.id);
    // Derived from the name, and derived the same way the migration's backfill
    // derived the originals.
    expect(res.body.data.code).toBe("PRINTER_JAMS");

    // The ticket that prompted the promotion is NOT re-filed. Its category is
    // what the desk actually worked it under, and rewriting that would change
    // what every past report says about a period already closed.
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.categoryId).toBe(other.id);
    expect(after.categoryOther).toBe("Printer jams");
  });

  it("refuses a name or a code the customer already uses, saying which", async () => {
    const { acme } = await categories();
    const sam = await login("sam.rivera@acme.com");

    const byName = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "network", customerId: acme.id }); // differs only in case
    expect(byName.status).toBe(400);
    expect(byName.body.error.message).toMatch(/already has a category|code/i);

    const byCode = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "Net Work", customerId: acme.id, code: "NETWORK" });
    expect(byCode.status).toBe(400);
    expect(byCode.body.error.message).toMatch(/code/i);
  });

  it("asks for a code when the name derives to none", async () => {
    const { acme } = await categories();
    const sam = await login("sam.rivera@acme.com");

    // `categoryCode` keeps only letters and digits, so a wholly Thai name
    // derives to an empty string — which is not a usable grouping key, and
    // storing one would quietly break every report that groups by it.
    const res = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "เครื่องพิมพ์", customerId: acme.id });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/code/i);

    const withCode = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "เครื่องพิมพ์", customerId: acme.id, code: "PRINTER" });
    expect(withCode.status).toBe(201);
    expect(withCode.body.data.code).toBe("PRINTER");
  });

  it("records who promoted what", async () => {
    const { acme } = await categories();
    const sam = await login("sam.rivera@acme.com");
    const res = await request(app)
      .post(`${API}/categories`)
      .set(bearer(sam))
      .send({ name: "Printer jams", customerId: acme.id })
      .expect(201);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "category", entityId: res.body.data.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("category.created");
    expect(audit!.meta).toMatchObject({ code: "PRINTER_JAMS", customerId: acme.id });
  });
});
