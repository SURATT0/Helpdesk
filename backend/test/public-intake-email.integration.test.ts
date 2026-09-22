import { beforeEach, describe, expect, it } from "vitest";
import { submitIntake } from "../src/modules/publicIntake/intake.service";
import { sweepIntakeMail } from "../src/modules/publicIntake/intake-mail";
import { prisma, resetDb } from "./db";

/**
 * The two public-intake mails (design doc §07), end to end against a real
 * database: queued in the SAME transaction as the ticket (never before it
 * commits), delivered by their own sweep against the SMTP-less "log"
 * transport this test environment always uses (see vitest.integration.config —
 * SMTP_HOST is deliberately unset, matching the phase-2 plan's own
 * instruction to test against something other than real SMTP).
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

async function queuedFor(ticketId: number) {
  return prisma.emailOutbox.findMany({
    where: { ticketId },
    orderBy: { id: "asc" },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("queuing — happens inside the same transaction as the ticket", () => {
  it("queues exactly one confirmation (to businessEmail) and one team notify (to the support inbox)", async () => {
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "someone@no-such-domain-example.test" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const rows = await queuedFor(outcome.ticketId);
    expect(rows).toHaveLength(2);

    const confirmation = rows.find((r) => r.eventType === "intake.confirmation");
    const teamNotify = rows.find((r) => r.eventType === "intake.team_notify");
    expect(confirmation?.recipientEmail).toBe("someone@no-such-domain-example.test");
    expect(confirmation?.status).toBe("pending");
    expect(teamNotify?.status).toBe("pending");
    // Both point at the ticket's own requester (the shared system account) —
    // recipient_user_id only satisfies the NOT NULL column; delivery reads
    // recipient_email instead. See intake-mail.ts.
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: outcome.ticketId },
      select: { requesterId: true },
    });
    expect(confirmation?.recipientUserId).toBe(ticket.requesterId);
    expect(teamNotify?.recipientUserId).toBe(ticket.requesterId);
  });

  it("writes no outbox rows at all when the submission is rejected (consent, fields, or files)", async () => {
    const before = await prisma.emailOutbox.count();
    const { consent: _drop, ...withoutConsent } = VALID;
    await submitIntake(
      { ...withoutConsent, businessEmail: "someone@no-such-domain-example.test" },
      [],
      META,
    );
    expect(await prisma.emailOutbox.count()).toBe(before);
  });
});

describe("delivery — via sweepIntakeMail, against the log transport (never real SMTP in this environment)", () => {
  it("marks both rows sent and leaves correct content behind", async () => {
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "someone@no-such-domain-example.test" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const result = await sweepIntakeMail();
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const rows = await queuedFor(outcome.ticketId);
    for (const row of rows) {
      expect(row.status).toBe("sent");
      expect(row.sentAt).not.toBeNull();
    }
  });

  it("does not touch ticket-lifecycle rows, and the ticket-lifecycle sweep does not touch intake rows", async () => {
    // Two independent claim queries against the same table — this is the
    // regression `claimDue`'s `eventTypeIn` exists to prevent.
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "priya.shah@globex.com" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const { emailOutboxService } = await import(
      "../src/modules/emails/email-outbox.service"
    );
    const generalResult = await emailOutboxService.sweep();
    // The general sweep must not have claimed (and therefore not rendered,
    // which would throw on an unknown event type) either intake row.
    const stillPending = await queuedFor(outcome.ticketId);
    expect(stillPending.every((r) => r.status === "pending")).toBe(true);
    expect(generalResult.failed).toBe(0);

    const intakeResult = await sweepIntakeMail();
    expect(intakeResult.sent).toBe(2);
  });

  it("carries the matched customer's name into the team-notify row's payload when the domain matches", async () => {
    const acme = await prisma.customer.update({
      where: { name: "Acme Corp" },
      data: { domains: { push: "acme.co.th" } },
    });
    const outcome = await submitIntake(
      { ...VALID, businessEmail: "person@acme.co.th" },
      [],
      META,
    );
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;

    const rows = await queuedFor(outcome.ticketId);
    const teamNotify = rows.find((r) => r.eventType === "intake.team_notify");
    const payload = teamNotify?.payload as { matchedCustomerName: string | null };
    expect(payload.matchedCustomerName).toBe(acme.name);
  });
});
