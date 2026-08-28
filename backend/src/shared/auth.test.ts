import { describe, it, expect } from "vitest";
import {
  hasPermission,
  maySeeTeamWorkload,
  maySeeWorkloadOf,
  permissionsFor,
  type AuthUser,
} from "./auth";
import type { Role } from "./domain";

const user = (role: Role, id = 1, customerId: number | null = null): AuthUser => ({
  id,
  name: "Test",
  email: "test@acme.com",
  role,
  teamId: null,
  department: null,
  customerId,
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

  /**
   * A tripwire, not a behaviour test.
   *
   * The web app keeps a copy of these grants in
   * `frontend/src/lib/permissions.ts` so its Permissions page can DERIVE what
   * each role may do instead of restating it — and a hand-written copy is how
   * that page came to claim only a super_admin may assign a ticket. Changing an
   * admin's grants here without updating that file puts a wrong answer on
   * screen, so this fails until both move together.
   */
  it("pins the admin grant list (mirrored in frontend/src/lib/permissions.ts)", () => {
    expect(permissionsFor("admin")).toEqual([
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
    ]);
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

describe("maySeeTeamWorkload", () => {
  it("admits super admins and nobody else", () => {
    expect(maySeeTeamWorkload(user("super_admin"))).toBe(true);
    expect(maySeeTeamWorkload(user("admin"))).toBe(false);
    expect(maySeeTeamWorkload(user("user"))).toBe(false);
  });

  it("does not depend on reach, unlike isPlatformWide", () => {
    // A customer's own super admin runs that customer's desk and must be able to
    // see its workload; `ticketScopeWhere` is what keeps the figures inside their
    // tenant. Folding reach in here would leave every tenant unmanageable.
    expect(maySeeTeamWorkload(user("super_admin", 1, 7))).toBe(true);
    expect(maySeeTeamWorkload(user("super_admin", 1, null))).toBe(true);
  });

  it("cannot be replaced by a permission check, which is why it is a role check", () => {
    // The trap this guards: super_admin holds "*", so ANY grant name passes for
    // them — including one invented for this. A permission string could never
    // separate an admin from a super admin here.
    expect(hasPermission(user("super_admin"), "report:workload")).toBe(true);
    expect(hasPermission(user("admin"), "report:workload")).toBe(false);
    // …which looks like it would work, until you notice it also passes for every
    // other unrelated string, so it says nothing about this decision.
    expect(hasPermission(user("super_admin"), "not:a:real:grant")).toBe(true);
  });
});

describe("maySeeWorkloadOf", () => {
  it("always lets a person read their own figures", () => {
    expect(maySeeWorkloadOf(user("user", 5), 5)).toBe(true);
    expect(maySeeWorkloadOf(user("admin", 5), 5)).toBe(true);
  });

  it("refuses an agent asking about a colleague", () => {
    expect(maySeeWorkloadOf(user("admin", 5), 6)).toBe(false);
    expect(maySeeWorkloadOf(user("user", 5), 6)).toBe(false);
  });

  it("lets a super admin read anyone", () => {
    expect(maySeeWorkloadOf(user("super_admin", 5), 6)).toBe(true);
  });
});
