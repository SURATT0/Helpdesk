import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb } from "./db";

/**
 * The rules the DATABASE holds, asserted against the database.
 *
 * Two of these are partial indexes, which Prisma has no syntax for: they live
 * in the migration as raw SQL and are absent from schema.prisma. `migrate diff`
 * leaves indexes it does not recognise alone today, but nothing promises it
 * always will — so this file is the tripwire. If a future migration drops one,
 * a test goes red instead of a guarantee quietly disappearing.
 *
 * The third, the composite foreign key, IS declared in the schema (`references:
 * [id, customerId]`) precisely because leaving it raw made `migrate diff`
 * propose dropping it. It is tested here beside the others because it is the
 * same kind of promise: a rule no write path can forget.
 *
 * These go through Prisma rather than raw SQL on purpose — a guarantee that
 * only holds for hand-written SQL is not protecting the application.
 */
beforeAll(async () => {
  await resetDb();
});

const acme = () =>
  prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
const globex = () =>
  prisma.customer.findFirstOrThrow({ where: { name: "Globex Inc" } });

describe("a ticket can only point at a project of its own customer", () => {
  it("refuses another customer's project", async () => {
    const [a, g] = [await acme(), await globex()];
    const acmeProject = await prisma.project.findFirstOrThrow({
      where: { customerId: a.id, deletedAt: null },
    });
    const globexTicket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: g.id },
    });

    await expect(
      prisma.ticket.update({
        where: { id: globexTicket.id },
        data: { projectId: acmeProject.id },
      }),
    ).rejects.toThrow();

    const after = await prisma.ticket.findUniqueOrThrow({
      where: { id: globexTicket.id },
    });
    expect(after.projectId).toBeNull();
  });

  it("accepts a project of the ticket's own customer", async () => {
    const a = await acme();
    const project = await prisma.project.findFirstOrThrow({
      where: { customerId: a.id, deletedAt: null },
    });
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: a.id },
    });
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { projectId: project.id },
    });
    expect(updated.projectId).toBe(project.id);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { projectId: null },
    });
  });

  it("leaves a ticket with no project alone", async () => {
    // Postgres skips a composite foreign key when any column is NULL (MATCH
    // SIMPLE). That is what keeps the column genuinely optional rather than
    // "optional until the constraint notices".
    const a = await acme();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { customerId: a.id },
    });
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { projectId: null },
    });
    expect(updated.projectId).toBeNull();
  });
});

describe("project names are unique per customer among LIVE projects", () => {
  it("refuses a second live project with the same name", async () => {
    const a = await acme();
    const existing = await prisma.project.findFirstOrThrow({
      where: { customerId: a.id, deletedAt: null },
    });
    await expect(
      prisma.project.create({
        data: { name: existing.name, customerId: a.id },
      }),
    ).rejects.toThrow();
  });

  it("frees the name once the project is archived", async () => {
    // The behaviour the partial index exists for. Under the old constraint the
    // second create failed, and the person doing it was looking at a project
    // list that did not contain the culprit.
    const a = await acme();
    const created = await prisma.project.create({
      data: { name: "Constraint probe — reuse", customerId: a.id },
    });
    await prisma.project.update({
      where: { id: created.id },
      data: { deletedAt: new Date() },
    });

    const reused = await prisma.project.create({
      data: { name: "Constraint probe — reuse", customerId: a.id },
    });
    expect(reused.id).not.toBe(created.id);

    await prisma.project.deleteMany({
      where: { id: { in: [created.id, reused.id] } },
    });
  });

  it("still lets two customers each run a project of the same name", async () => {
    const [a, g] = [await acme(), await globex()];
    const one = await prisma.project.create({
      data: { name: "Constraint probe — shared name", customerId: a.id },
    });
    const two = await prisma.project.create({
      data: { name: "Constraint probe — shared name", customerId: g.id },
    });
    expect(two.id).not.toBe(one.id);
    await prisma.project.deleteMany({
      where: { id: { in: [one.id, two.id] } },
    });
  });
});

describe("category names and codes", () => {
  /**
   * The SHARED-category cases that used to sit here are gone, with the partial
   * index they asserted (`categories_shared_name_key`). They tested that two
   * rows with a NULL owner could not share a name — a rule about a state that no
   * longer exists, since `customer_id` is required and every category belongs to
   * one tenant. `@@unique([customerId, name])` now covers the whole question on
   * its own, with no NULLs left for Postgres to treat as distinct.
   *
   * What replaced them is the pair below: the same name IS allowed across
   * tenants, and the code is what must stay unique within one.
   */
  it("lets two customers each keep a category of the same name", async () => {
    const [a, g] = [await acme(), await globex()];
    // Both tenants get "Network" from the starter set, which is the shape the
    // shared row used to serve — one subject, one row per customer.
    const both = await prisma.category.findMany({
      where: { name: "Network", customerId: { in: [a.id, g.id] } },
      select: { id: true, customerId: true, code: true },
    });
    expect(both).toHaveLength(2);
    // Same subject, different rows: which is exactly why a report cannot group
    // by id and has to group by code.
    expect(new Set(both.map((c) => c.code))).toEqual(new Set(["NETWORK"]));
    expect(both[0].id).not.toBe(both[1].id);
  });

  it("refuses a second category with the same CODE within one customer", async () => {
    // The constraint that makes the code usable as a grouping key: two rows
    // sharing a code under one tenant would double-count that tenant in every
    // report that groups by it.
    const a = await acme();
    const existing = await prisma.category.findFirstOrThrow({
      where: { customerId: a.id, code: "NETWORK" },
    });
    await expect(
      prisma.category.create({
        // A different NAME, deliberately — otherwise the name constraint could
        // be the one that fires and this would pass without testing anything.
        data: { name: "Constraint probe — networking", code: existing.code, customerId: a.id },
      }),
    ).rejects.toThrow();
  });

  it("lets the same code exist under a DIFFERENT customer", async () => {
    const g = await globex();
    const own = await prisma.category.create({
      data: { name: "Constraint probe — own code", code: "PROBE_CODE", customerId: g.id },
    });
    const a = await acme();
    const other = await prisma.category.create({
      data: { name: "Constraint probe — own code", code: "PROBE_CODE", customerId: a.id },
    });
    expect(other.id).not.toBe(own.id);
    await prisma.category.deleteMany({ where: { id: { in: [own.id, other.id] } } });
  });

  it("refuses a second category of the same name within one customer", async () => {
    const a = await acme();
    const first = await prisma.category.create({
      data: {
        name: "Constraint probe — category",
        code: "PROBE_CATEGORY_A",
        customerId: a.id,
      },
    });
    await expect(
      prisma.category.create({
        // A DIFFERENT code, deliberately: what this asserts is that the NAME
        // collides within one customer. Reusing the code would leave the test
        // passing for whichever constraint fired first.
        data: {
          name: "Constraint probe — category",
          code: "PROBE_CATEGORY_B",
          customerId: a.id,
        },
      }),
    ).rejects.toThrow();
    await prisma.category.delete({ where: { id: first.id } });
  });
});

describe("deleting a customer cannot strand their categories", () => {
  it("refuses the delete rather than orphaning the rows", async () => {
    // RESTRICT, not Prisma's default. The original reason was sharper — on SET
    // NULL a delete turned that tenant's private categories into SHARED ones and
    // published them to everybody — and while the shared state is gone, the
    // constraint is not, because SET NULL is not even possible now: the column
    // is NOT NULL, so the alternative to refusing is failing mid-delete with the
    // customer already half removed.
    const victim = await prisma.customer.create({
      data: { name: "Constraint probe — customer" },
    });
    const category = await prisma.category.create({
      data: {
        name: "Constraint probe — private",
        code: "PROBE_PRIVATE",
        customerId: victim.id,
      },
    });

    await expect(
      prisma.customer.delete({ where: { id: victim.id } }),
    ).rejects.toThrow();

    const after = await prisma.category.findUniqueOrThrow({
      where: { id: category.id },
    });
    expect(after.customerId).toBe(victim.id);

    await prisma.category.delete({ where: { id: category.id } });
    await prisma.customer.delete({ where: { id: victim.id } });
  });

  it("gives a brand-new customer the starter set, so its ticket form works", async () => {
    // Without this a new tenant opens the create-ticket form to an empty
    // dropdown and cannot file at all: `categoryId` is required and every
    // category belongs to a tenant, so a customer with none is unusable.
    const fresh = await prisma.customer.create({
      data: { name: "Constraint probe — starter set" },
    });
    // Created through the repository, which is where the starter set is written
    // in the same transaction as the customer.
    const { customerRepository } = await import(
      "../src/modules/customers/customer.repository"
    );
    await prisma.customer.delete({ where: { id: fresh.id } });

    const made = await customerRepository.create(
      "Constraint probe — starter set",
      {
        id: 1,
        name: "probe",
        email: "probe@example.com",
        role: "super_admin",
        status: "active",
        teamId: null,
        department: null,
        customerId: null,
        customerIds: [],
        permissions: ["*"],
      },
    );

    const categories = await prisma.category.findMany({
      where: { customerId: made.id },
      select: { code: true },
    });
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.map((c) => c.code)).toContain("NETWORK");

    await prisma.category.deleteMany({ where: { customerId: made.id } });
    await prisma.auditLog.deleteMany({ where: { entityId: made.id, entity: "customer" } });
    await prisma.customer.delete({ where: { id: made.id } });
  });
});
