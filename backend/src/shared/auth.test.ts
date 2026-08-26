import { describe, it, expect } from "vitest";
import { hasPermission, permissionsFor, type AuthUser } from "./auth";
import type { Role } from "./domain";

const user = (role: Role): AuthUser => ({
  id: 1,
  name: "Test",
  email: "test@acme.com",
  role,
  teamId: null,
  department: null,
  customerId: null,
  permissions: permissionsFor(role),
});

describe("permissionsFor", () => {
  it("admin holds the wildcard", () => {
    expect(permissionsFor("super_admin")).toEqual(["*"]);
  });

  it("agent reads/writes/creates tickets + reads the directory, but not user:write", () => {
    const p = permissionsFor("admin");
    expect(p).toContain("ticket:write");
    expect(p).toContain("ticket:create");
    expect(p).toContain("user:read");
    expect(p).not.toContain("user:write");
  });

  it("admin reads the registers, the routing table and the trail — and writes none of them", () => {
    // The read/write split is the whole point of these four: an admin browsing
    // the asset register, the problem register, the routing table and the audit
    // log is desk work; owning a routing project is not, and nothing writes audit.
    const p = permissionsFor("admin");
    for (const read of [
      "asset:read",
      "problem:read",
      "project:read",
      "audit:read",
    ]) {
      expect(p).toContain(read);
    }
    expect(p).not.toContain("project:write");
    expect(p).not.toContain("ticket:assign");
  });

  it("requester can only read + create tickets", () => {
    expect(permissionsFor("user")).toEqual(["ticket:read", "ticket:create"]);
  });
});

describe("hasPermission", () => {
  it("admin passes any check via *", () => {
    expect(hasPermission(user("super_admin"), "user:write")).toBe(true);
    expect(hasPermission(user("super_admin"), "anything:at:all")).toBe(true);
  });

  it("agent has ticket:write but not user:write", () => {
    expect(hasPermission(user("admin"), "ticket:write")).toBe(true);
    expect(hasPermission(user("admin"), "user:write")).toBe(false);
  });

  it("requester cannot write tickets but can create them", () => {
    expect(hasPermission(user("user"), "ticket:write")).toBe(false);
    expect(hasPermission(user("user"), "ticket:create")).toBe(true);
  });
});
