import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { projectScopeWhere, resolveProjectCustomerId } from "./project.scope";

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "x@acme.com",
    name: "X",
    role: "super_admin",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

describe("projectScopeWhere", () => {
  it("gives a platform admin an unfiltered reach", () => {
    // Unfiltered on the tenant axis. `deletedAt` is not a reach clause and is
    // never waived — see the deleted-row test below.
    expect(projectScopeWhere(user({ role: "super_admin", customerId: null }))).toEqual(
      { deletedAt: null },
    );
  });

  it("confines everyone else to their own customer", () => {
    for (const role of ["super_admin", "admin", "user"] as const) {
      expect(projectScopeWhere(user({ role }))).toEqual({
        customerId: 7,
        deletedAt: null,
      });
    }
  });

  it("matches nothing for a customer-less principal below the top role", () => {
    // The factory defaults to super_admin, which with no customer is platform-wide
    // by design — so the sentinel case has to name a role that is not.
    expect(projectScopeWhere(user({ role: "admin", customerId: null }))).toEqual({
      id: -1,
      deletedAt: null,
    });
  });

  it("gives a platform-wide principal every customer's projects", () => {
    expect(
      projectScopeWhere(user({ role: "super_admin", customerId: null })),
    ).toEqual({ deletedAt: null });
  });

  /**
   * The clause that makes the soft delete a delete.
   *
   * Every role, every reach — including the platform-wide principal who is
   * exempt from the tenant filter. A deleted project is out of everyone's
   * scope, which is what lets one function stand in for "and remember to
   * exclude deleted ones" at six call sites, the member picker among them.
   */
  it("excludes deleted projects for every principal, platform-wide included", () => {
    const principals = [
      user({ role: "super_admin", customerId: null }),
      user({ role: "super_admin" }),
      user({ role: "admin" }),
      user({ role: "user" }),
      user({ role: "admin", customerId: null }),
    ];
    for (const p of principals) {
      expect(projectScopeWhere(p).deletedAt, p.role).toBeNull();
    }
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
      resolveProjectCustomerId(user({ role: "super_admin", customerId: null }), 99),
    ).toBe(99);
  });

  it("makes a platform admin say which customer", () => {
    // Null here becomes a 400 in the service — an admin has no customer to
    // default to, and guessing one would file the project in the wrong tenant.
    expect(
      resolveProjectCustomerId(
        user({ role: "super_admin", customerId: null }),
        undefined,
      ),
    ).toBeNull();
  });

  it("gives a customer-less principal below the top role nothing to create in", () => {
    expect(
      resolveProjectCustomerId(user({ role: "admin", customerId: null }), 99),
    ).toBeNull();
  });
});
