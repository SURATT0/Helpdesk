import { describe, expect, it } from "vitest";
import type { User } from "@/features/users/schemas";
import { canHoldWorkFor } from "./assignment";

/**
 * Mirrors the two candidate-side questions of `mayReceiveAssignment` in the
 * API's `modules/tickets/ticket.scope.ts`, whose own tests assert the same
 * table. Two copies, one answer — and the copy here decides only what a picker
 * OFFERS, so the failure it prevents is a name that comes back 403.
 */

const ACME = 2;
const GLOBEX = 3;

const staff = (over: Partial<User> = {}): User =>
  ({
    id: 5,
    name: "A",
    email: "a@example.test",
    role: "admin",
    customer: { id: ACME, name: "Acme Corp" },
    ...over,
  }) as User;

describe("canHoldWorkFor", () => {
  it("offers a customer's own staff that customer's work", () => {
    for (const role of ["admin", "super_admin"] as const) {
      expect(canHoldWorkFor(staff({ role }), ACME)).toBe(true);
    }
  });

  it("withholds another customer's work from them", () => {
    // The whole point: they cannot SEE that ticket, so holding it would take it
    // out of every queue at once.
    expect(canHoldWorkFor(staff(), GLOBEX)).toBe(false);
  });

  it("offers platform staff every customer's work", () => {
    // No tenant of their own plus the top role — they see every ticket, so work
    // routed to them is work somebody is really holding.
    const platform = staff({ role: "super_admin", customer: null });
    expect(canHoldWorkFor(platform, ACME)).toBe(true);
    expect(canHoldWorkFor(platform, GLOBEX)).toBe(true);
  });

  it("withholds everything from a requester", () => {
    // Even in their own customer: a requester's row scope cannot see a queue.
    expect(canHoldWorkFor(staff({ role: "user" }), ACME)).toBe(false);
  });

  it("withholds everything from customer-less staff below the top role", () => {
    // Mirrors `isPlatformWide`: no tenant is not the same as every tenant, and
    // the server reads this person as reaching nothing.
    expect(canHoldWorkFor(staff({ role: "admin", customer: null }), ACME)).toBe(
      false,
    );
  });

  it("confines a super admin who belongs to a customer", () => {
    // The role alone never granted cross-tenant reach, and must not here.
    const tenantSuper = staff({ role: "super_admin" });
    expect(canHoldWorkFor(tenantSuper, ACME)).toBe(true);
    expect(canHoldWorkFor(tenantSuper, GLOBEX)).toBe(false);
  });
});
