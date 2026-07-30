import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { assetScopeWhere } from "./asset.scope";

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "x@acme.com",
    name: "X",
    role: "agent",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

describe("assetScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(assetScopeWhere(user({ role: "admin", customerId: null }))).toEqual({});
  });

  it("confines staff to their own customer", () => {
    for (const role of ["manager", "agent", "requester"] as const) {
      expect(assetScopeWhere(user({ role, customerId: 7 }))).toEqual({
        customerId: 7,
      });
    }
  });

  it("matches nothing for a non-admin with no customer", () => {
    // Defensive: an unscoped non-admin must not fall through to "see everything".
    expect(assetScopeWhere(user({ role: "agent", customerId: null }))).toEqual({
      id: -1,
    });
  });

  it("never returns an empty clause for a non-admin", () => {
    // The empty object is the admin-only "all rows" clause — leaking it to any
    // other role would cross the tenant boundary.
    for (const role of ["manager", "agent", "requester"] as const) {
      for (const customerId of [7, null]) {
        expect(assetScopeWhere(user({ role, customerId }))).not.toEqual({});
      }
    }
  });
});
