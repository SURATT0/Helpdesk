import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { invalidatePermissionCache } from "../src/modules/permissions/permission.repository";
import { PERMISSION_KEYS } from "../src/shared/permissions";
import { prisma, resetDb } from "./db";

/**
 * The permission matrix, from the API's side.
 *
 * Two things are being proved and only one of them is obvious. The obvious one
 * is that the rules hold — a requester is refused, the top role cannot lock
 * itself out, nobody narrows their own role. The other is that an edit REACHES
 * a session that is already signed in, which is the whole reason the gate stopped
 * reading the access token: a token lives fifteen minutes and cannot be edited
 * afterwards, so anything gated on it would keep a revoked permission for a
 * quarter of an hour.
 */

const app = createApp();
const API = "/api/v1";

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password: "password123" });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Platform-wide super admin (holds permission:write), an agent, a requester. */
const SUPER_ADMIN = "sam.rivera@acme.com";
const AGENT = "dana.reyes@acme.com";
const REQUESTER = "marcus.chen@acme.com";

async function grantsOf(role: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { role: role as "admin" },
    select: { permission: true },
  });
  return rows.map((r) => r.permission).sort();
}

beforeEach(async () => {
  await resetDb();
  // The cache is per process and survives a database reset, so a test that
  // changed the grants would otherwise leak into the next one.
  invalidatePermissionCache();
});

describe("the grants the product starts with", () => {
  it("gives the top role every permission the catalogue defines", async () => {
    // Explicitly, not by wildcard. A `*` cannot be un-ticked on a matrix.
    expect(await grantsOf("super_admin")).toEqual([...PERMISSION_KEYS].sort());
  });

  it("gates nothing on a string no route asks for", async () => {
    const all = await prisma.rolePermission.findMany({
      select: { permission: true },
    });
    for (const row of all) {
      expect(PERMISSION_KEYS, row.permission).toContain(row.permission);
    }
  });
});

describe("who may read and change the matrix", () => {
  it("refuses a requester and an agent, and answers a super admin", async () => {
    for (const email of [REQUESTER, AGENT]) {
      const res = await request(app)
        .get(`${API}/permissions/matrix`)
        .set(bearer(await login(email)));
      expect(res.status, email).toBe(403);
    }

    const ok = await request(app)
      .get(`${API}/permissions/matrix`)
      .set(bearer(await login(SUPER_ADMIN)));
    expect(ok.status).toBe(200);
    // The catalogue travels with the grants: the screen renders what each
    // permission MEANS, which is code and not a row in the table.
    expect(ok.body.data.permissions.length).toBe(PERMISSION_KEYS.length);
    expect(ok.body.data.grants.admin).toContain("ticket:write");
    expect(ok.body.data.locked).toContain("permission:write");
  });
});

describe("a requester cannot reach past the gate", () => {
  it("is refused creating a customer, whatever the UI shows them", async () => {
    // The named case from the brief: hiding a button is not a protection, so the
    // endpoint is called directly.
    const res = await request(app)
      .post(`${API}/customers`)
      .set(bearer(await login(REQUESTER)))
      .send({ name: "Straight At The API Ltd" });

    expect(res.status).toBe(403);
    expect(await prisma.customer.count({ where: { name: "Straight At The API Ltd" } })).toBe(0);
  });
});

describe("the rules that keep the desk recoverable", () => {
  it("refuses to take permission:write away from the top role", async () => {
    const sam = await login(SUPER_ADMIN);
    const keep = (await grantsOf("super_admin")).filter(
      (p) => p !== "permission:write",
    );

    const res = await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "super_admin", permissions: keep });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/permission:write/);
    // And nothing moved. A refusal that half-applied would be the worst of both.
    expect(await grantsOf("super_admin")).toContain("permission:write");
  });

  it("refuses to take user:write away from it either", async () => {
    const sam = await login(SUPER_ADMIN);
    const keep = (await grantsOf("super_admin")).filter((p) => p !== "user:write");

    const res = await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "super_admin", permissions: keep });

    expect(res.status).toBe(400);
    expect(await grantsOf("super_admin")).toContain("user:write");
  });

  it("refuses to narrow the role the editor is signed in as", async () => {
    const sam = await login(SUPER_ADMIN);
    const keep = (await grantsOf("super_admin")).filter((p) => p !== "kb:write");

    const res = await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "super_admin", permissions: keep });

    // Not a locked permission — refused because it is the actor's OWN role. The
    // mistake this prevents is specific: tidying the matrix and losing the
    // ability to finish.
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/your own role/i);
  });

  it("allows widening your own role, which takes nothing from anyone", async () => {
    const sam = await login(SUPER_ADMIN);
    const all = await grantsOf("super_admin");
    const res = await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "super_admin", permissions: all });
    expect(res.status).toBe(200);
  });

  it("refuses a permission that gates nothing", async () => {
    const sam = await login(SUPER_ADMIN);
    const res = await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "admin", permissions: ["ticket:read", "ticket:fly"] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/ticket:fly/);
    // Refused whole, so the caller does not half-get what they asked for.
    expect(await grantsOf("admin")).toContain("ticket:write");
  });
});

describe("an edit reaches a session that is already signed in", () => {
  it("takes a permission away mid-session, without a new token", async () => {
    // The agent signs in ONCE. The token minted here carries the permissions the
    // role held at that moment, and is never refreshed during this test.
    const dana = await login(AGENT);

    await request(app)
      .post(`${API}/kb`)
      .set(bearer(dana))
      .send({
        title: "Before the grant moved",
        excerpt: "A short summary, long enough for the validator.",
        body: "Written while the agent role still held kb:write.",
        categoryCode: "NETWORK",
        tags: ["permissions"],
        readMin: 2,
      })
      .expect(201);

    // An administrator takes kb:write off the agent role.
    const sam = await login(SUPER_ADMIN);
    const narrowed = (await grantsOf("admin")).filter((p) => p !== "kb:write");
    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "admin", permissions: narrowed })
      .expect(200);

    // The SAME token, now refused. This is what gating on the token could not do.
    const after = await request(app)
      .post(`${API}/kb`)
      .set(bearer(dana))
      .send({
        title: "After the grant moved",
        excerpt: "A short summary, long enough for the validator.",
        body: "Written with the same token, after kb:write was taken away.",
        categoryCode: "NETWORK",
        tags: ["permissions"],
        readMin: 2,
      });

    expect(after.status).toBe(403);
    expect(after.body.error.message).toMatch(/kb:write/);
  });

  it("gives one back mid-session too", async () => {
    const marcus = await login(REQUESTER);
    await request(app)
      .get(`${API}/users`)
      .set(bearer(marcus))
      .expect(403);

    const sam = await login(SUPER_ADMIN);
    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "user", permissions: [...(await grantsOf("user")), "user:read"] })
      .expect(200);

    await request(app).get(`${API}/users`).set(bearer(marcus)).expect(200);
  });
});

describe("what the trail records", () => {
  it("says who changed which role, and both sides of the change", async () => {
    const sam = await login(SUPER_ADMIN);
    const samRow = await prisma.user.findUniqueOrThrow({
      where: { email: SUPER_ADMIN },
    });
    const before = await grantsOf("admin");
    const narrowed = before.filter((p) => p !== "kb:write");

    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "admin", permissions: narrowed })
      .expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "permissions.changed" },
      orderBy: { id: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(samRow.id);
    // Before AND after, not only the delta: "removed kb:write" says what
    // happened; the two lists say what the role could do on either side of it,
    // which is the question an incident review actually asks.
    expect(audit!.meta).toMatchObject({
      role: "admin",
      removed: ["kb:write"],
      added: [],
    });
    expect((audit!.meta as { before: string[] }).before.sort()).toEqual(before);
    expect((audit!.meta as { after: string[] }).after.sort()).toEqual(narrowed);
  });

  it("writes nothing when a save changes nothing", async () => {
    const sam = await login(SUPER_ADMIN);
    const unchanged = await grantsOf("admin");
    const countBefore = await prisma.auditLog.count({
      where: { action: "permissions.changed" },
    });

    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "admin", permissions: unchanged })
      .expect(200);

    // A trail that records every SAVE rather than every CHANGE is one nobody can
    // read: the line that matters drowns among the ones that say nothing moved.
    expect(
      await prisma.auditLog.count({ where: { action: "permissions.changed" } }),
    ).toBe(countBefore);
  });
});

/**
 * The web app's half of the matrix.
 *
 * Every gate on the API reads the live grants, so an edit bites immediately on
 * the server. The SCREENS did not hear about it at all: they decided what to
 * render from hard-coded role lists, so revoking `ticket:write` from admin left
 * the status dropdown on the page, 403ing on every choice. The session payload
 * now carries the grants, and these pin that it is the live list rather than a
 * constant compiled in beside the role names.
 */
describe("the session payload carries the live grants", () => {
  it("sends an agent the permissions their role actually holds", async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: AGENT, password: "password123" });

    expect(res.status).toBe(200);
    const granted: string[] = res.body.data.user.permissions;
    expect(granted).toEqual(expect.arrayContaining(["ticket:write"]));
    expect(granted).not.toContain("user:write");
    // Whatever the matrix says, exactly — not a subset, not a role name.
    expect([...granted].sort()).toEqual(await grantsOf("admin"));
  });

  it("sends a requester their much shorter list", async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: REQUESTER, password: "password123" });

    expect(res.status).toBe(200);
    expect([...res.body.data.user.permissions].sort()).toEqual(
      await grantsOf("user"),
    );
    expect(res.body.data.user.permissions).not.toContain("ticket:write");
  });

  it("reflects an edit on the next /auth/me, without a new sign-in", async () => {
    // The case the whole change is for. Dana is signed in and holding a token
    // minted before the edit; the screens must stop offering what was taken
    // away without waiting for her to sign in again.
    const dana = await login(AGENT);
    const sam = await login(SUPER_ADMIN);

    const before = await request(app).get(`${API}/auth/me`).set(bearer(dana));
    expect(before.body.data.permissions).toContain("ticket:write");

    const kept = (await grantsOf("admin")).filter((p) => p !== "ticket:write");
    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "admin", permissions: kept })
      .expect(200);

    const after = await request(app).get(`${API}/auth/me`).set(bearer(dana));
    expect(after.status).toBe(200);
    expect(after.body.data.permissions).not.toContain("ticket:write");
    // And the API agrees with what it just told her — the payload is a snapshot
    // of the same answer the gate gives, not a second source.
    const refused = await request(app)
      .patch(`${API}/tickets/1042/status`)
      .set(bearer(dana))
      .send({ status: "pending" });
    expect(refused.status).toBe(403);
  });

  it("reflects a grant ADDED to a role that never held it", async () => {
    // The direction a role list could not express at all: a desk deciding its
    // requesters may work tickets. The old client check was `["super_admin",
    // "admin"].includes(role)`, which hid the controls from Marcus for ever.
    const sam = await login(SUPER_ADMIN);
    const widened = [...(await grantsOf("user")), "ticket:write"];
    await request(app)
      .put(`${API}/permissions/matrix`)
      .set(bearer(sam))
      .send({ role: "user", permissions: widened })
      .expect(200);

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: REQUESTER, password: "password123" });
    expect(res.body.data.user.permissions).toContain("ticket:write");
  });
});
