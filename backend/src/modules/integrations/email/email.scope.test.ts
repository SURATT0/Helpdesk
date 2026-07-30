import { describe, expect, it } from "vitest";
import {
  senderMayReply,
  type ReplySenderFacts,
  type ReplyTargetFacts,
} from "./email.scope";

const ticket = (over: Partial<ReplyTargetFacts> = {}): ReplyTargetFacts => ({
  requesterId: 100,
  assigneeId: 200,
  customerId: 7,
  affectedUserIds: [300],
  ...over,
});

const sender = (over: Partial<ReplySenderFacts> = {}): ReplySenderFacts => ({
  id: 999,
  role: "requester",
  customerId: 7,
  ...over,
});

describe("senderMayReply", () => {
  it("lets the people already in the conversation reply", () => {
    for (const id of [100, 200, 300]) {
      expect(senderMayReply(ticket(), sender({ id }))).toBe(true);
    }
  });

  it("lets staff of the ticket's own customer reply", () => {
    for (const role of ["agent", "manager"] as const) {
      expect(senderMayReply(ticket(), sender({ role, customerId: 7 }))).toBe(true);
    }
  });

  it("lets a platform admin reply across tenants", () => {
    expect(
      senderMayReply(ticket(), sender({ role: "admin", customerId: null })),
    ).toBe(true);
  });

  it("keeps staff out of another customer's thread", () => {
    for (const role of ["agent", "manager"] as const) {
      expect(senderMayReply(ticket(), sender({ role, customerId: 8 }))).toBe(
        false,
      );
    }
  });

  // The bug this function was extracted to fix: keying the cross-tenant case on
  // `customerId == null` handed every tenant's threads to a customer-less agent,
  // while ticketScopeWhere grants that same user only their own tickets.
  it("does NOT treat a customer-less agent or manager as cross-tenant", () => {
    for (const role of ["agent", "manager"] as const) {
      expect(senderMayReply(ticket(), sender({ role, customerId: null }))).toBe(
        false,
      );
    }
  });

  it("rejects an unrelated requester, even inside the same customer", () => {
    expect(senderMayReply(ticket(), sender({ role: "requester" }))).toBe(false);
  });

  it("rejects a stranger claiming a ticket that has no customer", () => {
    expect(
      senderMayReply(
        ticket({ customerId: null }),
        sender({ role: "agent", customerId: null }),
      ),
    ).toBe(false);
  });
});
