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
  role: "user",
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
    for (const role of ["admin", "super_admin"] as const) {
      expect(senderMayReply(ticket(), sender({ role, customerId: 7 }))).toBe(true);
    }
  });

  it("lets a platform admin reply across tenants", () => {
    expect(
      senderMayReply(ticket(), sender({ role: "super_admin", customerId: null })),
    ).toBe(true);
  });

  it("keeps staff out of another customer's thread", () => {
    for (const role of ["admin", "super_admin"] as const) {
      expect(senderMayReply(ticket(), sender({ role, customerId: 8 }))).toBe(
        false,
      );
    }
  });

  // The bug this function was extracted to fix: keying the cross-tenant case on
  // `customerId == null` alone handed every tenant's threads to any staff member
  // who happened to have no customer, while ticketScopeWhere grants that same user
  // only their own tickets. `isPlatformWide` requires the top role as well, which
  // is what keeps this case closed.
  it("does NOT treat a customer-less admin as cross-tenant", () => {
    expect(
      senderMayReply(ticket(), sender({ role: "admin", customerId: null })),
    ).toBe(false);
  });

  it("does treat a customer-less super admin as cross-tenant", () => {
    // The platform-wide principal: the top role with no tenant of its own.
    expect(
      senderMayReply(ticket(), sender({ role: "super_admin", customerId: null })),
    ).toBe(true);
  });

  it("rejects an unrelated requester, even inside the same customer", () => {
    expect(senderMayReply(ticket(), sender({ role: "user" }))).toBe(false);
  });

  it("rejects a stranger claiming a ticket that has no customer", () => {
    expect(
      senderMayReply(
        ticket({ customerId: null }),
        sender({ role: "admin", customerId: null }),
      ),
    ).toBe(false);
  });
});
