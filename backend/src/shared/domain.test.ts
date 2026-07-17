import { describe, it, expect } from "vitest";
import { canTransition, STATUS_TRANSITIONS, type TicketStatus } from "./domain";

const ALL: TicketStatus[] = [
  "new",
  "open",
  "in_progress",
  "pending",
  "resolved",
  "closed",
];

describe("STATUS_TRANSITIONS whitelist", () => {
  it("matches the documented flow", () => {
    expect(STATUS_TRANSITIONS.new).toEqual(["open", "in_progress"]);
    expect(STATUS_TRANSITIONS.open).toEqual([
      "in_progress",
      "pending",
      "resolved",
    ]);
    expect(STATUS_TRANSITIONS.in_progress).toEqual(["pending", "resolved"]);
    expect(STATUS_TRANSITIONS.pending).toEqual(["in_progress", "resolved"]);
    expect(STATUS_TRANSITIONS.resolved).toEqual(["open", "closed"]);
    expect(STATUS_TRANSITIONS.closed).toEqual(["open"]);
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

  it("rejects known illegal jumps", () => {
    expect(canTransition("new", "resolved")).toBe(false);
    expect(canTransition("new", "closed")).toBe(false);
    expect(canTransition("closed", "in_progress")).toBe(false);
    expect(canTransition("pending", "closed")).toBe(false);
  });

  it("allows the requester-reject and reopen paths", () => {
    expect(canTransition("resolved", "open")).toBe(true); // requester rejects
    expect(canTransition("resolved", "closed")).toBe(true); // confirm/auto-close
    expect(canTransition("closed", "open")).toBe(true); // reopen
  });
});
