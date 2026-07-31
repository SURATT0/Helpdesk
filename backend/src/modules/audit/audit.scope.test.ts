import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { auditScopeWhere } from "./audit.scope";

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

describe("auditScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(auditScopeWhere(user({ role: "admin", customerId: null }))).toEqual({});
  });

  it("confines a manager to entries written by their own customer's users", () => {
    expect(auditScopeWhere(user({ role: "manager", customerId: 3 }))).toEqual({
      user: { customerId: 3 },
    });
  });

  it("matches nothing for a non-admin with no customer", () => {
    expect(auditScopeWhere(user({ role: "manager", customerId: null }))).toEqual({
      id: -1,
    });
  });

  it("never returns an empty clause for a non-admin", () => {
    for (const role of ["manager", "agent", "requester"] as const) {
      for (const customerId of [3, null]) {
        expect(auditScopeWhere(user({ role, customerId }))).not.toEqual({});
      }
    }
  });

  // A customer-scoped clause must go through the actor relation: filtering on a
  // column of audit_logs itself would silently match nothing, since the table
  // has no customer_id.
  it("scopes through the actor relation, not a column on audit_logs", () => {
    const clause = auditScopeWhere(user({ role: "manager", customerId: 3 }));
    expect(clause).toHaveProperty("user");
    expect(clause).not.toHaveProperty("customerId");
  });
});
