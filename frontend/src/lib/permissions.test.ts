import { describe, expect, it } from "vitest";
import {
  ROLES,
  ROLE_PERMISSIONS,
  holds,
  maySeeTeamWorkload,
  maySeeWorkloadOf,
  rolesHolding,
} from "./permissions";
import { CAPABILITIES } from "@/features/permissions/components/permissions-view";

describe("holds", () => {
  it("gives super_admin everything through the wildcard", () => {
    expect(holds("super_admin", "ticket:delete")).toBe(true);
    expect(holds("super_admin", "anything:at:all")).toBe(true);
  });

  it("gives an admin ticket:write but not user:write", () => {
    expect(holds("admin", "ticket:write")).toBe(true);
    expect(holds("admin", "user:write")).toBe(false);
  });

  it("gives a requester only reading and raising", () => {
    expect(ROLE_PERMISSIONS.user).toEqual(["ticket:read", "ticket:create"]);
    expect(holds("user", "ticket:write")).toBe(false);
  });
});

describe("rolesHolding", () => {
  it("needs every permission, not any of them", () => {
    // A role holding one half of a two-part row must not get a tick for it.
    expect(rolesHolding(["ticket:read", "user:write"])).toEqual(["super_admin"]);
    expect(rolesHolding(["asset:read", "problem:read"])).toEqual([
      "admin",
      "super_admin",
    ]);
  });

  it("returns roles in the matrix's column order", () => {
    expect(rolesHolding(["ticket:read"])).toEqual([...ROLES]);
  });
});

/**
 * The three rows the page had wrong, pinned by the answer rather than by the
 * mechanism — a later refactor of `rolesHolding` should not be able to quietly
 * put the old claims back on screen.
 */
describe("the permission matrix the Permissions page renders", () => {
  const row = (key: string) => {
    const found = CAPABILITIES.find((c) => c.key === key);
    if (!found) throw new Error(`no capability row for ${key}`);
    return rolesHolding(found.perms);
  };

  it("lets an admin assign a ticket and set its priority", () => {
    // Both routes ask for ticket:write. The page claimed super_admin only.
    expect(row("cap.assign")).toEqual(["admin", "super_admin"]);
  });

  it("keeps handing over a whole queue at the top tier", () => {
    expect(row("cap.handover")).toEqual(["super_admin"]);
  });

  it("says an admin writes the knowledge base", () => {
    // kb:write is enforced on three KB routes and was absent from the page.
    expect(row("cap.kb")).toEqual(["admin", "super_admin"]);
  });

  it("says only the top tier deletes a ticket", () => {
    expect(row("cap.deleteTicket")).toEqual(["super_admin"]);
  });

  it("names a real permission on every row", () => {
    const known = new Set(
      Object.values(ROLE_PERMISSIONS).flatMap((g) => g.filter((p) => p !== "*")),
    );
    // ticket:assign, user:write, project:write and ticket:delete are held by
    // nobody explicitly — only super_admin's `*` — so they are legitimately
    // absent from the grant lists and are listed here instead.
    const wildcardOnly = new Set([
      "ticket:assign",
      "user:write",
      "project:write",
      "ticket:delete",
      // Deleting a routing project, gated the same way as deleting a ticket:
      // named by no grant list, so only super_admin's `*` reaches it.
      "project:delete",
      // Configuring the desk's notification policy — which events are mailed,
      // how often, when the SLA starts warning. Same gate again: no grant list
      // names it, so it belongs to the top tier alone.
      "settings:write",
    ]);
    const unknown = CAPABILITIES.flatMap((c) => c.perms).filter(
      (p) => !known.has(p) && !wildcardOnly.has(p),
    );
    expect(unknown).toEqual([]);
  });

  it("leaves no row that nobody can do", () => {
    const dead = CAPABILITIES.filter((c) => rolesHolding(c.perms).length === 0);
    expect(dead).toEqual([]);
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

  it("is not reachable through holds(), which is why it exists", () => {
    // The trap: `*` satisfies any invented grant name for super_admin — and for
    // nobody else — so a permission check LOOKS like it works here…
    expect(holds("super_admin", "report:workload")).toBe(true);
    expect(holds("admin", "report:workload")).toBe(false);
    // …but it passes just as happily for a string nobody has ever defined, so it
    // is not evidence of anything. The role check is the honest form.
    expect(holds("super_admin", "totally:made:up")).toBe(true);
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
