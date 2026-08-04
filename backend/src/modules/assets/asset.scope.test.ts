import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { assetScopeWhere } from "./asset.scope";

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({
    id: 1,
    email: "x@acme.com",
    name: "X",
    role: "admin",
    customerId: 7,
    permissions: [],
    ...over,
  }) as AuthUser;

describe("assetScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(assetScopeWhere(user({ role: "super_admin", customerId: null }))).toEqual({});
  });

  it("confines staff to their own customer", () => {
    for (const role of ["super_admin", "admin", "user"] as const) {
      expect(assetScopeWhere(user({ role, customerId: 7 }))).toEqual({
        customerId: 7,
      });
    }
  });

  it("matches nothing for a non-admin with no customer", () => {
    // Defensive: an unscoped non-admin must not fall through to "see everything".
    expect(assetScopeWhere(user({ role: "admin", customerId: null }))).toEqual({
      id: -1,
    });
  });

  it("returns the all-rows clause only for a platform-wide principal", () => {
    // The empty object means "every row". Platform-wide is the pairing of the top
    // role with no customer of its own: a customer-bound super_admin must stay
    // inside its tenant, and a customer-less admin must not be promoted to every
    // tenant just for lacking one.
    for (const role of ["super_admin", "admin", "user"] as const) {
      for (const customerId of [7, null]) {
        const clause = assetScopeWhere(user({ role, customerId }));
        if (role === "super_admin" && customerId == null) {
          expect(clause).toEqual({});
        } else {
          expect(clause).not.toEqual({});
        }
      }
    }
  });
});
