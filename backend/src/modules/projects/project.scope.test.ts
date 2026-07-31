import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { projectScopeWhere, resolveProjectCustomerId } from "./project.scope";

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "x@acme.com",
    name: "X",
    role: "manager",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

describe("projectScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(projectScopeWhere(user({ role: "admin", customerId: null }))).toEqual(
      {},
    );
  });

  it("confines everyone else to their own customer", () => {
    for (const role of ["manager", "agent", "requester"] as const) {
      expect(projectScopeWhere(user({ role }))).toEqual({ customerId: 7 });
    }
  });

  it("matches nothing for a non-admin with no customer", () => {
    expect(projectScopeWhere(user({ customerId: null }))).toEqual({ id: -1 });
  });
});

describe("resolveProjectCustomerId", () => {
  it("uses the actor's own customer, ignoring what they asked for", () => {
    // The requested id is discarded rather than honoured: otherwise a manager
    // could plant a routing target inside another tenant.
    expect(resolveProjectCustomerId(user(), 99)).toBe(7);
    expect(resolveProjectCustomerId(user(), undefined)).toBe(7);
  });

  it("lets a platform admin name the customer", () => {
    expect(
      resolveProjectCustomerId(user({ role: "admin", customerId: null }), 99),
    ).toBe(99);
  });

  it("makes a platform admin say which customer", () => {
    // Null here becomes a 400 in the service — an admin has no customer to
    // default to, and guessing one would file the project in the wrong tenant.
    expect(
      resolveProjectCustomerId(
        user({ role: "admin", customerId: null }),
        undefined,
      ),
    ).toBeNull();
  });

  it("gives a customer-less non-admin nothing to create in", () => {
    expect(
      resolveProjectCustomerId(user({ role: "manager", customerId: null }), 99),
    ).toBeNull();
  });
});
