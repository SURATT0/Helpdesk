import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "./db";

/**
 * The database sorts Thai the way a Thai reader reads it.
 *
 * Every assertion here goes through Prisma's ordinary `orderBy` — no COLLATE in
 * the query — because that is exactly what the column collation is for: the six
 * repository methods that sort by name say `orderBy: { name: "asc" }` and cannot
 * say anything else, since Prisma models no collation at all.
 *
 * Which is also why this file exists. Prisma cannot see the collation, so a
 * `migrate dev` that alters one of these columns will drop it silently and
 * nothing else in the suite would notice: the ordering would simply go back to
 * byte order, correct-looking in English and wrong in Thai. See backend/CLAUDE.md.
 */

/**
 * The audit's test set, in the order a Thai dictionary puts it.
 *
 * Within one initial consonant the order is by vowel, and a syllable with no
 * written vowel comes first — ก gives กบ, then เกม, then ไก่. The leading vowels
 * เ แ โ ใ ไ are the point: written first, sorted last, and a byte sort gets that
 * exactly backwards.
 */
const THAI_IN_ORDER = [
  "กบ",
  "เกม",
  "ไก่",
  "ขนม",
  "แขก",
  "งาน",
  "จอ",
  "ใจ",
  "เน็ต",
  "โปรแกรม",
  "ฟอง",
  "ไฟ",
  "ระบบ",
  "อีเมล",
  "ฮาร์ดดิสก์",
];

beforeEach(async () => {
  await resetDb();
});

/** A tenant of this file's own, so the fixture cannot collide with the seed. */
async function tenantWithCategories(names: string[]): Promise<number> {
  const customer = await prisma.customer.create({
    data: { name: `Collation ${Date.now()}-${Math.random()}` },
  });
  await prisma.category.createMany({
    data: names.map((name, i) => ({
      name,
      // The code is ASCII by construction everywhere else; these only have to be
      // unique per tenant, and must NOT be what the ordering falls back to.
      code: `C${i}`,
      customerId: customer.id,
    })),
  });
  return customer.id;
}

describe("categories come back in Thai dictionary order", () => {
  it("orders a Thai fixture correctly through a plain Prisma orderBy", async () => {
    // Inserted in reverse, so passing cannot be an accident of insertion order.
    const customerId = await tenantWithCategories([...THAI_IN_ORDER].reverse());

    const rows = await prisma.category.findMany({
      where: { customerId },
      orderBy: { name: "asc" },
      select: { name: true },
    });

    expect(rows.map((r) => r.name)).toEqual(THAI_IN_ORDER);
  });

  it("puts เกม second, not eleventh", async () => {
    // The regression in one assertion. Under byte order every leading-vowel word
    // is stranded after the whole consonant alphabet, and เกม lands after
    // ฮาร์ดดิสก์ rather than beside กบ and ไก่.
    const customerId = await tenantWithCategories([...THAI_IN_ORDER]);

    const names = (
      await prisma.category.findMany({
        where: { customerId },
        orderBy: { name: "asc" },
        select: { name: true },
      })
    ).map((r) => r.name);

    expect(names.indexOf("เกม")).toBe(1);
    expect(names.indexOf("ไก่")).toBe(2);
    expect(names.indexOf("เกม")).toBeLessThan(names.indexOf("ขนม"));
  });

  it("groups Thai before Latin", async () => {
    const customerId = await tenantWithCategories([
      "network",
      "กบ",
      "Network",
      "ไก่",
    ]);

    const names = (
      await prisma.category.findMany({
        where: { customerId },
        orderBy: { name: "asc" },
        select: { name: true },
      })
    ).map((r) => r.name);

    expect(names.slice(0, 2)).toEqual(["กบ", "ไก่"]);
    // Network and network sort adjacently — the collation is tertiary, so they
    // stay distinct values that happen to sit next to each other.
    expect(names.slice(2).sort()).toEqual(["Network", "network"]);
  });
});

describe("the other collated columns", () => {
  it("orders customers by name in Thai order", async () => {
    const stamp = `${Date.now()}`;
    // Prefixed so the fixture is the only thing this assertion looks at, and
    // suffixed so it cannot collide with a parallel run.
    const names = ["ไก่", "เกม", "กบ"].map((w) => `zz-${stamp} ${w}`);
    for (const name of names) await prisma.customer.create({ data: { name } });

    const rows = await prisma.customer.findMany({
      where: { name: { startsWith: `zz-${stamp} ` } },
      orderBy: { name: "asc" },
      select: { name: true },
    });

    expect(rows.map((r) => r.name)).toEqual([
      `zz-${stamp} กบ`,
      `zz-${stamp} เกม`,
      `zz-${stamp} ไก่`,
    ]);
  });

  it("orders projects by name in Thai order", async () => {
    const customer = await prisma.customer.create({
      data: { name: `Collation projects ${Date.now()}-${Math.random()}` },
    });
    for (const name of ["ไฟ", "ฟอง", "เกม"]) {
      await prisma.project.create({ data: { name, customerId: customer.id } });
    }

    const rows = await prisma.project.findMany({
      where: { customerId: customer.id },
      orderBy: { name: "asc" },
      select: { name: true },
    });

    expect(rows.map((r) => r.name)).toEqual(["เกม", "ฟอง", "ไฟ"]);
  });

  it("orders users by name in Thai order", async () => {
    const customer = await prisma.customer.create({
      data: { name: `Collation users ${Date.now()}-${Math.random()}` },
    });
    const stamp = Date.now();
    for (const [i, name] of ["ไก่", "กบ", "เกม"].entries()) {
      await prisma.user.create({
        data: {
          name,
          email: `collation-${stamp}-${i}@example.test`,
          passwordHash: "x",
          role: "user",
          status: "active",
          customerId: customer.id,
        },
      });
    }

    const rows = await prisma.user.findMany({
      where: { customerId: customer.id },
      orderBy: { name: "asc" },
      select: { name: true },
    });

    expect(rows.map((r) => r.name)).toEqual(["กบ", "เกม", "ไก่"]);
  });
});
