import { describe, expect, it } from "vitest";
import {
  hasPermission,
  maySeeTeamWorkload,
  maySeeWorkloadOf,
} from "./permissions";

describe("hasPermission", () => {
  const withGrants = (permissions: string[]) => ({ permissions });

  it("answers from the session's list, not from a role", () => {
    expect(hasPermission(withGrants(["ticket:write"]), "ticket:write")).toBe(true);
    expect(hasPermission(withGrants(["ticket:read"]), "ticket:write")).toBe(false);
  });

  it("follows the matrix when a grant is revoked from a role that used to hold it", () => {
    // The bug this function exists for: an admin whose `ticket:write` was taken
    // away in the matrix. The hard-coded `["super_admin", "admin"]` list this
    // replaced said yes here, and every control it gated then 403'd.
    const strippedAdmin = withGrants(["ticket:read", "ticket:create"]);
    expect(hasPermission(strippedAdmin, "ticket:write")).toBe(false);
  });

  it("follows the matrix when a grant is given to a role that never held it", () => {
    // And the other direction, which the role list could not express at all: a
    // desk that decides its requesters may close their own tickets.
    const empoweredUser = withGrants(["ticket:read", "ticket:create", "ticket:write"]);
    expect(hasPermission(empoweredUser, "ticket:write")).toBe(true);
  });

  it("honours the server's `*` wildcard", () => {
    expect(hasPermission(withGrants(["*"]), "anything:at:all")).toBe(true);
  });

  it("offers nothing when there is no session", () => {
    expect(hasPermission(null, "ticket:write")).toBe(false);
    expect(hasPermission(undefined, "ticket:write")).toBe(false);
  });

  it("offers nothing when the payload carried no list", () => {
    // What `authUserSchema`'s `.default([])` produces for a session restored
    // from a payload minted before the server sent grants. Hiding a control is
    // the recoverable direction; showing one that 403s is not.
    expect(hasPermission(withGrants([]), "ticket:write")).toBe(false);
  });
});

/**
 * Mirrors `maySeeTeamWorkload` / `maySeeWorkloadOf` in the API's shared/auth.ts,
 * whose own tests assert the same table. Two copies, one answer.
 */
describe("maySeeTeamWorkload", () => {
  it("admits super_admin alone", () => {
    expect(maySeeTeamWorkload("super_admin")).toBe(true);
    expect(maySeeTeamWorkload("admin")).toBe(false);
    expect(maySeeTeamWorkload("user")).toBe(false);
  });

  it("says no while the session is still loading", () => {
    // The UI calls this with `user?.role`, which is undefined on first paint. A
    // truthy default there would flash the per-agent surfaces before the session
    // arrives and then tear them down — visible, and briefly wrong.
    expect(maySeeTeamWorkload(undefined)).toBe(false);
  });

  it("is not reachable as a permission, which is why it exists", () => {
    // The trap: a wildcard satisfies any invented grant name — so a permission
    // check LOOKS like it works here…
    const wildcard = { permissions: ["*"] };
    expect(hasPermission(wildcard, "report:workload")).toBe(true);
    // …and passes just as happily for a string nobody has ever defined, so it is
    // not evidence of anything. There is no route gated on `report:workload`,
    // the catalogue does not define it, and nothing could grant it. The role
    // check is the honest form.
    expect(hasPermission(wildcard, "totally:made:up")).toBe(true);
    // And for anyone without the wildcard it is false whatever their role, so it
    // could never have expressed the rule this function holds.
    expect(hasPermission({ permissions: ["ticket:read"] }, "report:workload")).toBe(
      false,
    );
  });
});

describe("maySeeWorkloadOf", () => {
  const agent = { id: 5, role: "admin" } as const;

  it("always allows your own figures", () => {
    expect(maySeeWorkloadOf(agent, 5)).toBe(true);
    expect(maySeeWorkloadOf({ id: 9, role: "user" }, 9)).toBe(true);
  });

  it("refuses a colleague's", () => {
    expect(maySeeWorkloadOf(agent, 6)).toBe(false);
  });

  it("allows a super admin anyone's", () => {
    expect(maySeeWorkloadOf({ id: 1, role: "super_admin" }, 6)).toBe(true);
  });

  it("refuses when there is no session", () => {
    expect(maySeeWorkloadOf(null, 5)).toBe(false);
    expect(maySeeWorkloadOf(undefined, 5)).toBe(false);
  });
});
