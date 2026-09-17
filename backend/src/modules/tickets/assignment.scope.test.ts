import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { mayReceiveAssignment, type AssignmentCandidate } from "./ticket.scope";

const actor = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "manager@acme.com",
    name: "M",
    role: "super_admin",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

const candidate = (
  over: Partial<AssignmentCandidate> = {},
): AssignmentCandidate => ({
  id: 2,
  role: "admin",
  customerId: 7,
  isActive: true,
  ...over,
});

describe("mayReceiveAssignment", () => {
  it("lets a manager hand tickets to staff in their own customer", () => {
    for (const role of ["admin", "super_admin"] as const) {
      expect(actorMay(actor(), candidate({ role }))).toBe(true);
    }
  });

  it("refuses to make a requester an assignee", () => {
    // Requesters raise tickets; giving one a queue would put a ticket in the
    // hands of someone whose own row scope cannot even see it.
    expect(actorMay(actor(), candidate({ role: "user" }))).toBe(false);
    expect(
      actorMay(actor({ role: "super_admin", customerId: null }), candidate({ role: "user" })),
    ).toBe(false);
  });

  it("refuses a target in another customer", () => {
    expect(actorMay(actor(), candidate({ customerId: 8 }))).toBe(false);
  });

  it("lets a platform admin assign inside any customer", () => {
    // Reaching every tenant means being able to hand out every tenant's work —
    // to the people of THAT tenant.
    expect(
      actorMay(
        actor({ role: "super_admin", customerId: null }),
        candidate({ customerId: 8 }),
        8,
      ),
    ).toBe(true);
  });

  it("refuses a platform admin routing one customer's work to another's staff", () => {
    // The gap this argument was added to close. Reaching both tenants says the
    // ACTOR may hand work over; it says nothing about whether the RECEIVER can
    // see what they are being handed, and a customer-bound agent cannot see
    // another customer's ticket. Accepted, it produced a 200 followed by a 404
    // for the person it was assigned to — the ticket left every queue at once.
    expect(
      actorMay(
        actor({ role: "super_admin", customerId: null }),
        candidate({ customerId: 8 }),
        7,
      ),
    ).toBe(false);
  });

  it("lets platform staff hold any customer's work", () => {
    // The other direction, and it has to keep working: somebody with no tenant
    // of their own sees every ticket, so work routed to them is work somebody
    // is really holding. This is what makes a platform super admin a legitimate
    // owner of a customer's routing project.
    const platformStaff = candidate({ role: "super_admin", customerId: null });
    for (const workCustomer of [7, 8]) {
      expect(
        actorMay(
          actor({ role: "super_admin", customerId: null }),
          platformStaff,
          workCustomer,
        ),
      ).toBe(true);
    }
  });

  it("refuses work whose customer is unknown", () => {
    // Nothing legitimate reaches here — `tickets.customer_id` is NOT NULL — but
    // an absent tenant must read as "nobody may hold it" rather than as a
    // wildcard, which is the direction the rest of the reach rules fail in.
    expect(actorMay(actor(), candidate(), null)).toBe(false);
  });

  it("grants a customer-less actor below the top role nothing", () => {
    // Mirrors ticketScopeWhere, which gives this same user only their own
    // tickets rather than a whole tenant. A customer-less super_admin is excluded
    // here because it is platform-wide on purpose.
    expect(actorMay(actor({ role: "admin", customerId: null }), candidate())).toBe(
      false,
    );
  });

  it("refuses a customer-less staff target for a scoped actor", () => {
    expect(actorMay(actor(), candidate({ customerId: null }))).toBe(false);
  });

  it("refuses a closed account, whoever is asking", () => {
    // The account is shut: no sign-in, and nothing new lands on it. True
    // regardless of reach, so even a platform-wide actor cannot route to them.
    expect(actorMay(actor(), candidate({ isActive: false }))).toBe(false);
    expect(
      actorMay(
        actor({ role: "super_admin", customerId: null }),
        candidate({ isActive: false }),
      ),
    ).toBe(false);
  });

  it("still allows an active but unavailable target", () => {
    // `availableForAssignment` is a rota and is not this decision — someone at
    // lunch may still be handed a queue; someone who has left may not. Keeping
    // the two apart is the point of having both.
    expect(actorMay(actor(), candidate({ isActive: true }))).toBe(true);
  });
});

/**
 * Tiny indirection so each assertion reads as "actor may / may not".
 *
 * `workCustomerId` defaults to 7, the customer both fixtures sit in, so every
 * case that is not about the work's tenant reads as before.
 */
function actorMay(
  a: AuthUser,
  c: AssignmentCandidate,
  workCustomerId: number | null = 7,
): boolean {
  return mayReceiveAssignment(a, c, workCustomerId);
}
