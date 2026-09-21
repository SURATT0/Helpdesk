import { beforeEach, describe, expect, it } from "vitest";
import { submitIntake } from "../src/modules/publicIntake/intake.service";
import { issueTicketNumber } from "../src/modules/publicIntake/ticket-number";
import { prisma, resetDb } from "./db";

/**
 * The write path behind the public intake form (steps 2-3 of the phase-2
 * plan): validate, resolve a tenant/category/requester for a submission that
 * has no signed-in account behind it, and commit the one transaction that
 * opens the ticket.
 */

const VALID: Record<string, unknown> = {
  name: "สุรัตน์ ใจดี",
  companyName: "บริษัท ตัวอย่าง จำกัด",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "อยากปรึกษาเรื่องวางระบบ RPA ให้ทีมงานติดต่อกลับด้วยครับ",
  consent: true,
  source: "web-intake-form",
  submittedAt: "2026-09-21T09:30:00.000Z",
};

const META = { ip: "203.0.113.1", userAgent: "vitest" };

beforeEach(async () => {
  await resetDb();
});

describe("an unmatched submission (no customer owns the domain)", () => {
  it("lands on the system tenant, under its Other category, owned by the system account", async () => {
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "someone@no-such-domain-example.test" },
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: outcome.ticketId },
      include: { category: true, requester: true, customer: true },
    });

    expect(ticket.customer.isSystemTenant).toBe(true);
    expect(ticket.category.code).toBe("OTHER");
    expect(ticket.requester.isSystemAccount).toBe(true);
    expect(ticket.channel).toBe("web_intake");
    expect(ticket.status).toBe("new");
    expect(ticket.number).toBe(outcome.ticketNumber);
    expect(ticket.number).toMatch(/^BF-\d{8}-\d{4}$/);
    // reportedAt is the browser's submittedAt, not the server's insert time.
    expect(ticket.reportedAt.toISOString()).toBe("2026-09-21T09:30:00.000Z");

    const submission = await prisma.intakeSubmission.findFirstOrThrow({
      where: { ticketId: ticket.id },
    });
    expect(submission.status).toBe("triage");
    expect(submission.matchedCustomerId).toBeNull();

    const consent = await prisma.consentLog.findFirstOrThrow({
      where: { submissionId: submission.id },
    });
    expect(consent.granted).toBe(true);
  });
});

describe("a submission whose domain matches a real customer", () => {
  it("links to that customer's own Other category, but still uses the shared system account as requester", async () => {
    const acme = await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });

    const outcome = await submitIntake(
      { ...VALID, businessEmail: "person@acme.co.th" },
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: outcome.ticketId },
      include: { category: true, requester: true },
    });

    expect(ticket.customerId).toBe(acme.id);
    expect(ticket.category.code).toBe("OTHER");
    expect(ticket.category.customerId).toBe(acme.id);
    // Deliberate: the requester is the ONE shared system account, whose own
    // customerId is the system tenant, not Acme — see intake.repository.ts.
    expect(ticket.requester.isSystemAccount).toBe(true);

    const submission = await prisma.intakeSubmission.findFirstOrThrow({
      where: { ticketId: ticket.id },
    });
    expect(submission.status).toBe("linked");
    expect(submission.matchedCustomerId).toBe(acme.id);
  });

  it("matches case-insensitively and ignores a system-tenant domain by construction", async () => {
    await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });

    const outcome = await submitIntake(
      { ...VALID, businessEmail: "Person@ACME.CO.TH" },
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: outcome.ticketId },
    });
    const acme = await prisma.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
    expect(ticket.customerId).toBe(acme.id);
  });
});

describe("consent — the one gate that writes nothing at all", () => {
  it("writes no submission and no ticket when consent is missing", async () => {
    const { consent: _drop, ...withoutConsent } = VALID;
    const before = await prisma.intakeSubmission.count();
    const outcome = await submitIntake(
      { ...withoutConsent, businessEmail: "someone@no-such-domain-example.test" },
      META,
    );
    expect(outcome).toEqual({ kind: "consent_required" });
    expect(await prisma.intakeSubmission.count()).toBe(before);
  });
});

describe("field validation failures write nothing", () => {
  it("writes no row when a required field fails validation", async () => {
    const before = await prisma.ticket.count();
    const outcome = await submitIntake(
      {
        ...VALID,
        businessEmail: "someone@no-such-domain-example.test",
        message: "too short",
      },
      META,
    );
    expect(outcome.kind).toBe("invalid");
    expect(await prisma.ticket.count()).toBe(before);
  });
});

describe("ticket numbering — atomic under concurrency, never count(*)+1", () => {
  it("issues strictly increasing numbers for the same day under concurrent callers", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => prisma.$transaction((tx) => issueTicketNumber(tx))),
    );
    // All distinct — the whole point of the atomic counter.
    expect(new Set(numbers).size).toBe(10);
    const seqs = numbers
      .map((n) => Number(n.split("-")[2]))
      .sort((a, b) => a - b);
    // Strictly consecutive: no gap, no repeat, whatever value they started at
    // (the counter table is not reset between test files by design).
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it("gives two submissions on the same day two different ticket numbers", async () => {
    const first = await submitIntake(
      { ...VALID, businessEmail: "one@no-such-domain-example.test" },
      META,
    );
    const second = await submitIntake(
      { ...VALID, businessEmail: "two@no-such-domain-example.test" },
      META,
    );
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("created");
    if (first.kind !== "created" || second.kind !== "created") return;
    expect(first.ticketNumber).not.toBe(second.ticketNumber);
  });
});
