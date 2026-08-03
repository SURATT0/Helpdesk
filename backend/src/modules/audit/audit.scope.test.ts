import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { auditScopeWhere } from "./audit.scope";

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

describe("auditScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(auditScopeWhere(user({ role: "super_admin", customerId: null }))).toEqual({});
  });

  it("confines a customer-bound super admin to entries written by their own customer's users", () => {
    expect(auditScopeWhere(user({ role: "super_admin", customerId: 3 }))).toEqual({
      user: { customerId: 3 },
    });
  });

  it("matches nothing for a customer-less principal below the top role", () => {
    // A customer-less super_admin is platform-wide by design, so the sentinel
    // case has to be a role that is not: an admin with no tenant.
    expect(auditScopeWhere(user({ role: "admin", customerId: null }))).toEqual({
      id: -1,
    });
  });

  it("returns the all-rows clause only for a platform-wide principal", () => {
    // The empty object means "every row". Platform-wide is the pairing of the top
    // role with no customer of its own: a customer-bound super_admin must stay
    // inside its tenant, and a customer-less admin must not be promoted to every
    // tenant just for lacking one.
    for (const role of ["super_admin", "admin", "user"] as const) {
      for (const customerId of [3, null]) {
        const clause = auditScopeWhere(user({ role, customerId }));
        if (role === "super_admin" && customerId == null) {
          expect(clause).toEqual({});
        } else {
          expect(clause).not.toEqual({});
        }
      }
    }
  });

  // A customer-scoped clause must go through the actor relation: filtering on a
  // column of audit_logs itself would silently match nothing, since the table
  // has no customer_id.
  it("scopes through the actor relation, not a column on audit_logs", () => {
    const clause = auditScopeWhere(user({ role: "super_admin", customerId: 3 }));
    expect(clause).toHaveProperty("user");
    expect(clause).not.toHaveProperty("customerId");
  });
});
