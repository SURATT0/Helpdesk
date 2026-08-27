import { describe, it, expect } from "vitest";
import { canTransition, STATUS_TRANSITIONS, type TicketStatus } from "./domain";

const ALL: TicketStatus[] = ["new", "pending", "closed"];

describe("STATUS_TRANSITIONS whitelist", () => {
  it("matches the documented flow", () => {
    // New → In Progress is missing on purpose: taking a ticket is an assignment,
    // not a status change, and both read from the same stored `new`.
    expect(STATUS_TRANSITIONS.new).toEqual(["pending", "closed"]);
    expect(STATUS_TRANSITIONS.pending).toEqual(["new", "closed"]);
    expect(STATUS_TRANSITIONS.closed).toEqual(["new"]);
  });
});

describe("canTransition", () => {
  it("returns true exactly for whitelisted (from → to) pairs", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(
          STATUS_TRANSITIONS[from].includes(to),
        );
      }
    }
  });

  it("treats a same-status move as not a transition", () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it("allows the two ways a finished ticket can go", () => {
    // The requester rejects it, or it is confirmed (or auto-closed at 72h).
    expect(canTransition("pending", "new")).toBe(true);
    expect(canTransition("pending", "closed")).toBe(true);
  });

  it("allows a reopen, and only into the queue", () => {
    // Back to `new`; the service keeps the assignee, so it returns as that
    // person's In Progress rather than as unowned work.
    expect(canTransition("closed", "new")).toBe(true);
    expect(canTransition("closed", "pending")).toBe(false);
  });

  it("lets the desk close its own ticket without asking anyone", () => {
    // The internal-thread case: staff raised it, staff finished it, there is
    // nobody to confirm — so `new → closed` is a legal end, not a jumped step.
    expect(canTransition("new", "closed")).toBe(true);
  });
});
