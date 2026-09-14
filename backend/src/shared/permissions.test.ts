import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  INITIAL_ROLE_PERMISSIONS,
  isKnownPermission,
  LOCKED_FOR_TOP_ROLE,
  PERMISSIONS,
  PERMISSION_KEYS,
} from "./permissions";
import { ROLE_PERMISSIONS } from "./auth";

/**
 * The catalogue is the list of gates that exist. The grant table says who holds
 * them, and is editable; this file pins the things that must stay true whatever
 * anybody ticks.
 */

describe("the catalogue", () => {
  it("names each permission once", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("describes every one of them", () => {
    for (const p of PERMISSIONS) {
      expect(p.description.trim().length, p.key).toBeGreaterThan(10);
      // `subject:verb`, the shape every gate in the API is written in.
      expect(p.key, p.key).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });

  it("keeps the two keys that open the door on this side of it", () => {
    // Without `user:write` nobody can change who holds a role; without
    // `permission:write` nobody can change what a role may do. Losing either is
    // the one edit this product could not undo from the inside.
    expect([...LOCKED_FOR_TOP_ROLE].sort()).toEqual([
      "permission:write",
      "user:write",
    ]);
  });

  it("recognises its own keys and nothing else", () => {
    expect(isKnownPermission("ticket:write")).toBe(true);
    expect(isKnownPermission("ticket:fly")).toBe(false);
    // `*` in particular. It is still honoured by `hasPermission` so a row added
    // by hand behaves as it reads, but it is not something the matrix may grant:
    // a wildcard cannot be un-ticked.
    expect(isKnownPermission("*")).toBe(false);
  });
});

describe("moving the grants into the database changed nothing", () => {
  /**
   * The old constant is still in `shared/auth.ts`. It is no longer consulted at
   * request time — the table is — and it stays there for exactly this
   * comparison: the migration that filled the table was a transcription, and
   * this is what makes that claim checkable rather than asserted.
   */
  /**
   * Permissions that did not exist in the old grant table because their gate was
   * a ROLE COMPARISON in a service rather than a `requirePermission` on a route.
   *
   * Converting those is the other half of "one source of truth", and each one
   * has to land on exactly the roles its comparison allowed — a permission left
   * off is a silent demotion dressed as a refactor, which is what happened to
   * `customer:write` before this list existed to name it.
   */
  const CONVERTED_FROM_ROLE_CHECKS: Record<string, readonly string[]> = {
    // customer.service: `role === "admin" || role === "super_admin"`
    "customer:write": ["admin", "super_admin"],
    // comment.service: `role === "super_admin"`
    "comment:moderate": ["super_admin"],
  };

  it("gives admin and user what the constant gave them, plus the conversions", () => {
    for (const role of ["admin", "user"] as const) {
      const converted = Object.entries(CONVERTED_FROM_ROLE_CHECKS)
        .filter(([, roles]) => roles.includes(role))
        .map(([key]) => key);
      expect([...INITIAL_ROLE_PERMISSIONS[role]].sort(), role).toEqual(
        [...ROLE_PERMISSIONS[role], ...converted].sort(),
      );
    }
  });

  it("gives the top role every converted permission too", () => {
    for (const [key, roles] of Object.entries(CONVERTED_FROM_ROLE_CHECKS)) {
      if (!roles.includes("super_admin")) continue;
      expect(INITIAL_ROLE_PERMISSIONS.super_admin, key).toContain(key);
    }
  });

  it("expands super_admin's wildcard into the whole catalogue", () => {
    // The one deliberate difference, and the reason for it: `*` cannot be
    // un-ticked, so every box on the matrix would read as on and stay on however
    // it was clicked. The top role now holds an explicit list like everyone else.
    expect(ROLE_PERMISSIONS.super_admin).toEqual(["*"]);
    expect([...INITIAL_ROLE_PERMISSIONS.super_admin].sort()).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });

  it("grants nothing that gates nothing", () => {
    // A grant naming a string no route asks for would sit in the table looking
    // like a permission and do nothing at all.
    for (const [role, grants] of Object.entries(INITIAL_ROLE_PERMISSIONS)) {
      for (const p of grants) {
        expect(isKnownPermission(p), `${role} holds ${p}`).toBe(true);
      }
    }
  });

  it("leaves the top role holding everything it can be asked for", () => {
    // This is the assertion that FAILS when a permission is added to the
    // catalogue and nobody decides who gets it — which is the point. The
    // wildcard used to make that decision silently; now it is a red test.
    expect([...INITIAL_ROLE_PERMISSIONS.super_admin].sort()).toEqual(
      [...PERMISSION_KEYS].sort(),
    );
  });
});

describe("the migration that filled the table", () => {
  /**
   * The migration is generated from the constant and then lives on as SQL, so
   * the two can drift the moment somebody edits one of them. This reads the
   * actual file.
   *
   * It has already caught two mistakes in one sitting: a generator that
   * mis-parsed a single-line array and silently dropped `ticket:create` from
   * `user`, and a grant left out of `admin` that the hard-coded check it
   * replaced had allowed — a silent demotion dressed as a refactor. Neither was
   * visible by reading either file on its own.
   */
  // Resolved from the working directory rather than from `import.meta.url`:
  // this package's tsconfig targets CommonJS, where that meta-property is a
  // compile error even though the test runner transpiles it happily. Vitest runs
  // from the package root, which is what this path is relative to.
  const sql = readFileSync(
    "prisma/migrations/20260911155000_role_permissions/migration.sql",
    "utf8",
  );

  /** Every ('role', 'permission') pair the INSERT actually writes. */
  const inserted = new Map<string, string[]>();
  for (const [, role, permission] of sql.matchAll(
    /\('(super_admin|admin|user)',\s*'([^']+)'\)/g,
  )) {
    inserted.set(role, [...(inserted.get(role) ?? []), permission]);
  }

  it.each(["super_admin", "admin", "user"] as const)(
    "gives %s exactly what the constant says",
    (role) => {
      expect((inserted.get(role) ?? []).sort()).toEqual(
        [...INITIAL_ROLE_PERMISSIONS[role]].sort(),
      );
    },
  );

  it("writes every row and no others", () => {
    const total = [...inserted.values()].reduce((n, list) => n + list.length, 0);
    const expected = Object.values(INITIAL_ROLE_PERMISSIONS).reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(total).toBe(expected);
  });
});
