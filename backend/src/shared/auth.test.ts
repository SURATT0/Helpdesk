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
  permissions: permissionsFor(role),
});

describe("permissionsFor", () => {
  it("admin holds the wildcard", () => {
    expect(permissionsFor("admin")).toEqual(["*"]);
  });

  it("agent reads/writes/creates tickets + reads the directory, but not user:write", () => {
    const p = permissionsFor("agent");
    expect(p).toContain("ticket:write");
    expect(p).toContain("ticket:create");
    expect(p).toContain("user:read");
    expect(p).not.toContain("user:write");
  });

  it("requester can only read + create tickets", () => {
    expect(permissionsFor("requester")).toEqual(["ticket:read", "ticket:create"]);
  });
});

describe("hasPermission", () => {
  it("admin passes any check via *", () => {
    expect(hasPermission(user("admin"), "user:write")).toBe(true);
    expect(hasPermission(user("admin"), "anything:at:all")).toBe(true);
  });

  it("agent has ticket:write but not user:write", () => {
    expect(hasPermission(user("agent"), "ticket:write")).toBe(true);
    expect(hasPermission(user("agent"), "user:write")).toBe(false);
  });

  it("requester cannot write tickets but can create them", () => {
    expect(hasPermission(user("requester"), "ticket:write")).toBe(false);
    expect(hasPermission(user("requester"), "ticket:create")).toBe(true);
  });
});
