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

describe("category names", () => {
  it("refuses a second SHARED category with the same name", async () => {
    // `@@unique([customerId, name])` cannot do this on its own: Postgres treats
    // NULLs as distinct, so without the partial index both rows are allowed and
    // every tenant sees two identical entries in the picker.
    const shared = await prisma.category.findFirstOrThrow({
      where: { customerId: null },
    });
    await expect(
      prisma.category.create({
        data: { name: shared.name, code: "PROBE_SHARED_DUP", customerId: null },
      }),
    ).rejects.toThrow();
  });

  it("lets a customer name their own category after a shared one", async () => {
    const a = await acme();
    const shared = await prisma.category.findFirstOrThrow({
      where: { customerId: null },
    });
    const own = await prisma.category.create({
      data: { name: shared.name, code: "PROBE_OWN_AFTER_SHARED", customerId: a.id },
    });
    expect(own.customerId).toBe(a.id);
    await prisma.category.delete({ where: { id: own.id } });
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

describe("deleting a customer cannot publish their categories", () => {
  it("refuses the delete rather than turning private categories shared", async () => {
    // The failure mode of a nullable tenant column: on Prisma's default SET
    // NULL, deleting a customer would flip `customer_id` to NULL, which here
    // means "shared with everyone". RESTRICT instead — the delete fails.
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
});
