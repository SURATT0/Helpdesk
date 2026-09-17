import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/permissions";
import { CAPABILITIES, rolesHolding, type Grants } from "./matrix";

/**
 * The role × capability table the Permissions page renders.
 *
 * The page reads the LIVE matrix, so these cases feed `rolesHolding` a fixture
 * instead — the grants the product starts with, transcribed from
 * `INITIAL_ROLE_PERMISSIONS` in the API's `shared/permissions.ts`. A fixture in
 * a test is a different thing from the constant this replaced: pinning the
 * expected answer is what a test is for, and nothing renders from it.
 *
 * Three of these rows were once wrong on screen, and they are pinned by the
 * ANSWER rather than by the mechanism — a later refactor of `rolesHolding`
 * should not be able to quietly put the old claims back.
 */
const STARTING: Grants = {
  user: ["ticket:read", "ticket:create"],
  admin: [
    "ticket:read",
    "ticket:write",
    "ticket:create",
    "ticket:import",
    "user:read",
    "asset:write",
    "problem:write",
    "asset:read",
    "problem:read",
    "project:read",
    "audit:read",
    "kb:write",
    "customer:write",
  ],
  // Every key in the catalogue, expanded rather than a wildcard — which is what
  // the migration wrote, and why an every-box row can be un-ticked on the
  // editing screen. Written out rather than derived from CAPABILITIES, so the
  // "names a real permission" case below is a check and not a tautology.
  super_admin: [
    "ticket:read",
    "ticket:create",
    "ticket:write",
    "ticket:assign",
    "ticket:import",
    "ticket:delete",
    "kb:write",
    "problem:read",
    "problem:write",
    "asset:read",
    "asset:write",
    "user:read",
    "user:write",
    "project:read",
    "project:write",
    "project:delete",
    "customer:write",
    "customer:archive",
    "category:write",
    "audit:read",
    "settings:write",
    "comment:moderate",
    "permission:write",
  ],
};

describe("rolesHolding", () => {
  it("needs every permission, not any of them", () => {
    // A role holding one half of a two-part row must not get a tick for it.
    expect(rolesHolding(["ticket:read", "user:write"], STARTING)).toEqual([
      "super_admin",
    ]);
    expect(rolesHolding(["asset:read", "problem:read"], STARTING)).toEqual([
      "admin",
      "super_admin",
    ]);
  });

  it("returns roles in the matrix's column order", () => {
    expect(rolesHolding(["ticket:read"], STARTING)).toEqual([...ROLES]);
  });

  it("follows the matrix rather than the role", () => {
    // The whole reason the page stopped reading a constant: a desk that lets its
    // requesters work tickets, and one that has taken the knowledge base off its
    // admins. Neither is expressible by a role name.
    const edited: Grants = {
      user: ["ticket:read", "ticket:create", "ticket:write"],
      admin: STARTING.admin.filter((p) => p !== "kb:write"),
      super_admin: STARTING.super_admin,
    };
    expect(rolesHolding(["ticket:write"], edited)).toEqual([
      "user",
      "admin",
      "super_admin",
    ]);
    expect(rolesHolding(["kb:write"], edited)).toEqual(["super_admin"]);
  });

  it("honours the server's wildcard", () => {
    expect(rolesHolding(["anything:at:all"], { super_admin: ["*"] })).toEqual([
      "super_admin",
    ]);
  });

  it("gives an unknown role nothing rather than throwing", () => {
    // An empty cell understates what somebody can do, and the API is the gate.
    expect(rolesHolding(["ticket:read"], {})).toEqual([]);
  });
});

describe("the capability rows", () => {
  const row = (key: string) => {
    const found = CAPABILITIES.find((c) => c.key === key);
    if (!found) throw new Error(`no capability row for ${key}`);
    return rolesHolding(found.perms, STARTING);
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

  it("leaves no row that nobody can do", () => {
    const dead = CAPABILITIES.filter(
      (c) => rolesHolding(c.perms, STARTING).length === 0,
    );
    expect(dead).toEqual([]);
  });

  it("names a real permission on every row", () => {
    // `super_admin` holds every key the API's catalogue defines, so anything a
    // row asks for that is missing from it is a string no route gates on —
    // ungrantable on the matrix, and a row that could never be ticked.
    const known = new Set(STARTING.super_admin);
    const unknown = CAPABILITIES.flatMap((c) => c.perms).filter(
      (p) => !known.has(p),
    );
    expect(unknown).toEqual([]);
  });

  it("names each capability once", () => {
    const keys = CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
