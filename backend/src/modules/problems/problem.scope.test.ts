import { describe, expect, it } from "vitest";
import type { AuthUser } from "../../shared/auth";
import { problemScopeWhere } from "./problem.repository";

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

describe("problemScopeWhere", () => {
  it("gives a platform admin an unfiltered clause", () => {
    expect(problemScopeWhere(user({ role: "admin", customerId: null }))).toEqual(
      {},
    );
  });

  it("confines everyone else to their own customer", () => {
    expect(problemScopeWhere(user({ role: "manager", customerId: 3 }))).toEqual({
      customerId: 3,
    });
  });

  it("matches nothing for a non-admin with no customer", () => {
    expect(problemScopeWhere(user({ role: "agent", customerId: null }))).toEqual({
      id: -1,
    });
  });

  it("never returns an empty clause for a non-admin", () => {
    for (const role of ["manager", "agent", "requester"] as const) {
      for (const customerId of [3, null]) {
        expect(problemScopeWhere(user({ role, customerId }))).not.toEqual({});
      }
    }
  });
});
