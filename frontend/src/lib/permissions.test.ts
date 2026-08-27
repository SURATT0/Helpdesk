import { describe, expect, it } from "vitest";
import { ROLES, ROLE_PERMISSIONS, holds, rolesHolding } from "./permissions";
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
