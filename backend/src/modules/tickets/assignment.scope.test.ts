import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { mayReceiveAssignment, type AssignmentCandidate } from "./ticket.scope";

const actor = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "manager@acme.com",
    name: "M",
    role: "manager",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

const candidate = (
  over: Partial<AssignmentCandidate> = {},
): AssignmentCandidate => ({
  id: 2,
  role: "agent",
  customerId: 7,
  ...over,
});

describe("mayReceiveAssignment", () => {
  it("lets a manager hand tickets to staff in their own customer", () => {
    for (const role of ["agent", "manager"] as const) {
      expect(actorMay(actor(), candidate({ role }))).toBe(true);
    }
  });

  it("refuses to make a requester an assignee", () => {
    // Requesters raise tickets; giving one a queue would put a ticket in the
    // hands of someone whose own row scope cannot even see it.
    expect(actorMay(actor(), candidate({ role: "requester" }))).toBe(false);
    expect(
      actorMay(actor({ role: "admin", customerId: null }), candidate({ role: "requester" })),
    ).toBe(false);
  });

  it("refuses a target in another customer", () => {
    expect(actorMay(actor(), candidate({ customerId: 8 }))).toBe(false);
  });

  it("lets a platform admin assign across customers", () => {
    expect(
      actorMay(actor({ role: "admin", customerId: null }), candidate({ customerId: 8 })),
    ).toBe(true);
  });

  it("grants a customer-less non-admin actor nothing", () => {
    // Mirrors ticketScopeWhere, which gives this same user only their own
    // tickets rather than a whole tenant.
    for (const role of ["manager", "agent"] as const) {
      expect(actorMay(actor({ role, customerId: null }), candidate())).toBe(false);
    }
  });

  it("refuses a customer-less staff target for a scoped actor", () => {
    expect(actorMay(actor(), candidate({ customerId: null }))).toBe(false);
  });
});

// Tiny indirection so each assertion reads as "actor may / may not".
function actorMay(a: AuthUser, c: AssignmentCandidate): boolean {
  return mayReceiveAssignment(a, c);
}
