import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedEmail } from "./email-outbox.repository";
import type { StaffPayload } from "./email.events";

/**
 * Delivery behaviour: retries, collapsing, threading.
 *
 * The repository and the transport are both mocked — what is under test is the
 * sweep's decisions, and a real Postgres would only make them slower to check.
 * The recipient rules have their own suite; nothing here re-tests them.
 */

// `vi.mock` factories are hoisted above every import and every const in this
// file, so the doubles they hand out have to be created by `vi.hoisted` — a
// plain `const` up here is still in its temporal dead zone when the factory runs.
const { repo, sent, mailSender } = vi.hoisted(() => {
  const captured: unknown[] = [];
  return {
    repo: {
      claimDue: vi.fn(),
      markSent: vi.fn(),
      reschedule: vi.fn(),
      markFailed: vi.fn(),
      markSuppressed: vi.fn(),
      threadAnchors: vi.fn(),
      countSentSince: vi.fn(),
      pendingFor: vi.fn(),
      markCollapsed: vi.fn(),
      enqueue: vi.fn(),
    },
    sent: captured,
    mailSender: {
      transport: "test",
      send: vi.fn(async (mail: unknown) => {
        captured.push(mail);
        return { transport: "test", messageId: `<m${captured.length}@deskly>` };
      }),
    },
  };
});

vi.mock("./email-outbox.repository", () => ({ emailOutboxRepository: repo }));
vi.mock("../integrations/email/mail-sender", () => ({ mailSender }));
vi.mock("../audit/audit.repository", () => ({
  auditRepository: { record: vi.fn(async () => undefined) },
}));

// Static imports are safe here: vitest hoists `vi.mock` above them, so these
// resolve to the mocks declared just now.
import { emailOutboxService, __testing } from "./email-outbox.service";
import { auditRepository } from "../audit/audit.repository";
import { env } from "../../config/env";

const payload = (subject = "Printer jam"): StaffPayload => ({
  audience: "staff",
  ticket: {
    id: 1046,
    subject,
    displayStatus: "in_progress",
    priority: "high",
    category: "Hardware",
    requesterName: "Dana Reyes",
    assigneeName: "Jo Patel",
  },
  occurredAt: "2026-09-03T07:32:00.000Z",
  vars: { recipientName: "Jo Patel" },
});

const row = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id: 1,
  ticketId: 1046,
  eventType: "ticket.assigned",
  recipientUserId: 2,
  recipientEmail: "jo@acme.com",
  lang: "en",
  payload: payload(),
  attempts: 1,
  ...over,
});

const NOW = new Date("2026-09-03T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
  repo.threadAnchors.mockResolvedValue({});
  repo.countSentSince.mockResolvedValue(0);
  repo.pendingFor.mockResolvedValue([]);
  repo.claimDue.mockResolvedValue([]);
});

describe("a failed send never fails the user's action", () => {
  it("reschedules with exponential backoff instead of throwing", async () => {
    repo.claimDue.mockResolvedValue([row({ attempts: 1 })]);
    mailSender.send.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await emailOutboxService.sweep(NOW);

    expect(result.sent).toBe(0);
    expect(repo.reschedule).toHaveBeenCalledOnce();
    const [, nextAt, error] = repo.reschedule.mock.calls[0];
    // attempt 1 → base (60s). The row stays pending, so nothing is lost.
    expect((nextAt as Date).getTime() - NOW.getTime()).toBe(60_000);
    expect(error).toContain("ECONNREFUSED");
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it("backs off further on each attempt", async () => {
    repo.claimDue.mockResolvedValue([row({ attempts: 2 })]);
    mailSender.send.mockRejectedValueOnce(new Error("timeout"));
    await emailOutboxService.sweep(NOW);
    const [, nextAt] = repo.reschedule.mock.calls[0];
    expect((nextAt as Date).getTime() - NOW.getTime()).toBe(5 * 60_000);
  });

  it("gives up after the last attempt and records it as failed", async () => {
    repo.claimDue.mockResolvedValue([row({ attempts: 3 })]);
    mailSender.send.mockRejectedValueOnce(new Error("550 mailbox unavailable"));

    const result = await emailOutboxService.sweep(NOW);

    expect(result.failed).toBe(1);
    expect(repo.markFailed).toHaveBeenCalledOnce();
    expect(repo.reschedule).not.toHaveBeenCalled();
    expect(auditRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "email.failed" }),
    );
  });

  it("isolates one bad row from the rest of the batch", async () => {
    repo.claimDue.mockResolvedValue([
      row({ id: 1, recipientUserId: 2, eventType: "ticket.sla_breach" }),
      row({ id: 2, recipientUserId: 3, eventType: "ticket.sla_warning" }),
    ]);
    mailSender.send.mockRejectedValueOnce(new Error("boom"));

    const result = await emailOutboxService.sweep(NOW);

    expect(result.sent).toBe(1);
    expect(repo.reschedule).toHaveBeenCalledOnce();
  });
});

describe("threading", () => {
  it("has no In-Reply-To on the first mail of a conversation", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    repo.threadAnchors.mockResolvedValue({});
    await emailOutboxService.sweep(NOW);
    expect(sent[0]).toMatchObject({ inReplyTo: undefined, references: [] });
  });

  it("points the second mail back at the first", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    repo.threadAnchors.mockResolvedValue({ root: "<a@d>", last: "<a@d>" });
    await emailOutboxService.sweep(NOW);
    // Root and last are the same message here, so References carries it once.
    expect(sent[0]).toMatchObject({ inReplyTo: "<a@d>", references: ["<a@d>"] });
  });

  it("carries root then previous once a chain has grown", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    repo.threadAnchors.mockResolvedValue({ root: "<a@d>", last: "<c@d>" });
    await emailOutboxService.sweep(NOW);
    expect(sent[0]).toMatchObject({
      inReplyTo: "<c@d>",
      references: ["<a@d>", "<c@d>"],
    });
  });

  it("stamps the ticket id as a header so inbound need not parse the subject", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    await emailOutboxService.sweep(NOW);
    expect(sent[0]).toMatchObject({
      headers: { "X-Deskly-Ticket-Id": "1046" },
    });
  });

  it("records the Message-ID the transport minted, for the next mail to chain onto", async () => {
    repo.claimDue.mockResolvedValue([row({ id: 42 })]);
    await emailOutboxService.sweep(NOW);
    expect(repo.markSent).toHaveBeenCalledWith(42, "<m1@deskly>", NOW);
  });

  it("sends both a text and an HTML part", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    await emailOutboxService.sweep(NOW);
    const mail = sent[0] as { text: string; html: string };
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.html).toContain("<div");
  });
});

describe("anti-spam", () => {
  it("collapses into one summary once the per-ticket rate is exceeded", async () => {
    repo.claimDue.mockResolvedValue([row({ id: 9 })]);
    // Already at the limit in this window, and no summary sent yet.
    repo.countSentSince.mockImplementation(
      async (_t: number, _u: number, _s: Date, eventType?: string) =>
        eventType === "digest.multiple_updates" ? 0 : 3,
    );
    repo.pendingFor.mockResolvedValue([10, 11]);

    const result = await emailOutboxService.sweep(NOW);

    expect(result.sent).toBe(1);
    const mail = sent[0] as { text: string };
    expect(mail.text).toContain("3 updates");
    // The siblings are folded away rather than sent.
    expect(repo.markCollapsed).toHaveBeenCalledWith([10, 11], 9);
    expect(result.collapsed).toBe(2);
  });

  it("does not send a second summary in the same window", async () => {
    repo.claimDue.mockResolvedValue([row({ id: 9 })]);
    repo.countSentSince.mockImplementation(
      async (_t: number, _u: number, _s: Date, eventType?: string) =>
        eventType === "digest.multiple_updates" ? 1 : 4,
    );
    repo.pendingFor.mockResolvedValue([10]);

    const result = await emailOutboxService.sweep(NOW);

    expect(result.sent).toBe(0);
    expect(repo.markCollapsed).toHaveBeenCalledWith([9, 10], 9);
  });

  it("sends normally while under the limit", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    repo.countSentSince.mockResolvedValue(1);
    const result = await emailOutboxService.sweep(NOW);
    expect(result.sent).toBe(1);
    expect(repo.markCollapsed).not.toHaveBeenCalled();
  });
});

describe("bulk assignment", () => {
  it("turns twenty assignments into one summary per recipient", async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({
        id: 100 + i,
        ticketId: 2000 + i,
        recipientUserId: 7,
        eventType: "ticket.assigned",
        payload: payload(`Ticket number ${i}`),
      }),
    );
    repo.claimDue.mockResolvedValue(rows);

    const result = await emailOutboxService.sweep(NOW);

    expect(result.sent).toBe(1);
    expect(result.collapsed).toBe(19);
    const mail = sent[0] as { text: string };
    expect(mail.text).toContain("20 tickets were assigned to you");
    expect(mail.text).toContain("#2000");
    expect(mail.text).toContain("#2019");
  });

  it("gives each recipient their own summary", async () => {
    repo.claimDue.mockResolvedValue([
      row({ id: 1, ticketId: 10, recipientUserId: 7 }),
      row({ id: 2, ticketId: 11, recipientUserId: 7 }),
      row({ id: 3, ticketId: 12, recipientUserId: 8 }),
      row({ id: 4, ticketId: 13, recipientUserId: 8 }),
    ]);
    const result = await emailOutboxService.sweep(NOW);
    expect(result.sent).toBe(2);
  });

  it("leaves a single assignment as a normal mail, not a summary of one", async () => {
    repo.claimDue.mockResolvedValue([row({ eventType: "ticket.assigned" })]);
    await emailOutboxService.sweep(NOW);
    const mail = sent[0] as { text: string };
    expect(mail.text).toContain("This ticket is now yours to work.");
    expect(mail.text).not.toContain("were assigned to you");
  });

  it("groups only multi-row recipients", () => {
    const groups = __testing.groupBulkAssignments([
      row({ id: 1, recipientUserId: 7 }),
      row({ id: 2, recipientUserId: 8 }),
      row({ id: 3, recipientUserId: 8 }),
      row({ id: 4, recipientUserId: 9, eventType: "ticket.sla_breach" }),
    ]);
    expect([...groups.keys()]).toEqual([8]);
  });
});

describe("switches", () => {
  it("suppresses a disabled event rather than sending it", async () => {
    env.ticketEmail.disabledEvents.add("ticket.sla_warning");
    repo.claimDue.mockResolvedValue([row({ eventType: "ticket.sla_warning" })]);

    const result = await emailOutboxService.sweep(NOW);

    expect(result.suppressed).toBe(1);
    expect(mailSender.send).not.toHaveBeenCalled();
    expect(auditRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "email.suppressed" }),
    );
    env.ticketEmail.disabledEvents.delete("ticket.sla_warning");
  });
});

describe("audit", () => {
  it("records every delivery with the ticket, the event and the recipient", async () => {
    repo.claimDue.mockResolvedValue([row()]);
    await emailOutboxService.sweep(NOW);
    expect(auditRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email.sent",
        entity: "ticket",
        entityId: 1046,
        meta: expect.objectContaining({
          eventType: "ticket.assigned",
          recipient: "jo@acme.com",
        }),
      }),
    );
  });
});
