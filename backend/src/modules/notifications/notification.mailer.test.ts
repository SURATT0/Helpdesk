import { describe, expect, it } from "vitest";
import { __testing } from "./notification.mailer";
import type { PendingNotification } from "./notification.mailer";

const { subjectFor, bodyFor, NO_EMAIL_TYPES } = __testing;

const pending = (over: Partial<PendingNotification> = {}): PendingNotification => ({
  id: 1,
  type: "ticket.comment",
  ticketId: 1042,
  message: "New reply on ticket #1042",
  recipient: { id: 5, name: "Dana Reyes", email: "dana.reyes@acme.com" },
  ...over,
});

describe("subjectFor", () => {
  // The ref is what lets a reply to a notification thread back onto the ticket
  // instead of opening a new one.
  it("carries the ticket reference", () => {
    expect(subjectFor(pending())).toContain("[#1042]");
  });

  it("uses a human subject per known type", () => {
    expect(subjectFor(pending({ type: "ticket.comment" }))).toContain(
      "New reply",
    );
    expect(subjectFor(pending({ type: "ticket.sla_breach" }))).toContain(
      "breached",
    );
    expect(subjectFor(pending({ type: "ticket.sla_warning" }))).toContain(
      "approaching",
    );
  });

  it("falls back to the stored message for an unknown type", () => {
    const n = pending({ type: "something.new", message: "Custom text" });
    expect(subjectFor(n)).toContain("Custom text");
  });

  it("omits the ref when the notification has no ticket", () => {
    const s = subjectFor(pending({ ticketId: null, type: "something.new" }));
    expect(s).not.toContain("[#");
  });

  it("does not double-stamp a ref already in the message", () => {
    const n = pending({ type: "unknown.type", message: "[#1042] already here" });
    expect(subjectFor(n)).toBe("[#1042] already here");
  });
});

describe("bodyFor", () => {
  it("addresses the recipient and includes the message", () => {
    const body = bodyFor(pending());
    expect(body).toContain("Dana Reyes");
    expect(body).toContain("New reply on ticket #1042");
  });

  it("links to the ticket in the web app", () => {
    expect(bodyFor(pending())).toContain("/tickets/1042");
  });

  it("omits the link when there is no ticket", () => {
    expect(bodyFor(pending({ ticketId: null }))).not.toContain("/tickets/");
  });

  it("explains why the mail arrived and that replies are threaded", () => {
    const body = bodyFor(pending());
    expect(body).toContain("participant");
    expect(body.toLowerCase()).toContain("reply to this email");
  });
});

describe("NO_EMAIL_TYPES", () => {
  // Internal notes are agent-to-agent; mailing them would push internal
  // commentary somewhere a forward could leak it.
  it("excludes internal notes from email", () => {
    expect(NO_EMAIL_TYPES.has("ticket.internal_note")).toBe(true);
  });

  it("does not exclude the participant-facing types", () => {
    for (const type of [
      "ticket.comment",
      "ticket.assigned",
      "ticket.status_change",
      "ticket.sla_warning",
      "ticket.sla_breach",
    ]) {
      expect(NO_EMAIL_TYPES.has(type)).toBe(false);
    }
  });
});
