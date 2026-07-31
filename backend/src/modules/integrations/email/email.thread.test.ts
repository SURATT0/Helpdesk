import { describe, it, expect } from "vitest";
import {
  maySenderPostOnTicket,
  type ThreadSender,
  type ThreadTarget,
} from "./email.thread";

/** Ticket raised by user 1 (customer 10), worked by agent 2. */
const ticket: ThreadTarget = {
  requesterId: 1,
  assigneeId: 2,
  customerId: 10,
  affectedUserIds: [],
};

const sender = (over: Partial<ThreadSender>): ThreadSender => ({
  id: 99,
  role: "requester",
  customerId: 10,
  ...over,
});

describe("maySenderPostOnTicket", () => {
  it("lets the requester continue their own thread", () => {
    expect(maySenderPostOnTicket(sender({ id: 1 }), ticket)).toBe(true);
  });

  it("lets the assignee reply", () => {
    expect(maySenderPostOnTicket(sender({ id: 2, role: "agent" }), ticket)).toBe(
      true,
    );
  });

  it("lets an affected user reply even though they did not raise it", () => {
    expect(
      maySenderPostOnTicket(sender({ id: 7 }), {
        ...ticket,
        affectedUserIds: [7],
      }),
    ).toBe(true);
  });

  // The core of the fix: a subject line is attacker-controlled, so an unrelated
  // requester who types [#id] must not reach someone else's thread.
  it("refuses an unrelated requester in the same customer", () => {
    expect(maySenderPostOnTicket(sender({ id: 99 }), ticket)).toBe(false);
  });

  it("refuses an unrelated requester in another customer", () => {
    expect(
      maySenderPostOnTicket(sender({ id: 99, customerId: 20 }), ticket),
    ).toBe(false);
  });

  it("lets an agent of the same customer reply to any of its tickets", () => {
    expect(
      maySenderPostOnTicket(sender({ id: 3, role: "agent" }), ticket),
    ).toBe(true);
  });

  it("lets a manager of the same customer reply", () => {
    expect(
      maySenderPostOnTicket(sender({ id: 4, role: "manager" }), ticket),
    ).toBe(true);
  });

  // Matches ticketScopeWhere: staff see their OWN customer, never another's.
  it("refuses an agent from a different customer", () => {
    expect(
      maySenderPostOnTicket(
        sender({ id: 3, role: "agent", customerId: 20 }),
        ticket,
      ),
    ).toBe(false);
  });

  it("refuses a customer-less agent who is not a participant", () => {
    expect(
      maySenderPostOnTicket(
        sender({ id: 3, role: "agent", customerId: null }),
        ticket,
      ),
    ).toBe(false);
  });

  it("lets a platform admin reply to any customer's ticket", () => {
    expect(
      maySenderPostOnTicket(
        sender({ id: 5, role: "admin", customerId: null }),
        ticket,
      ),
    ).toBe(true);
  });

  it("does not treat a null assignee as a match for a null-ish sender", () => {
    expect(
      maySenderPostOnTicket(sender({ id: 99 }), {
        ...ticket,
        assigneeId: null,
      }),
    ).toBe(false);
  });
});
