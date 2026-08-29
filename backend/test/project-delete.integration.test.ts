import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb } from "./db";

/**
 * Who may delete a routing project, and what a deletion leaves behind.
 *
 * `project:delete` is held by no role explicitly, so only `super_admin`'s `*`
 * satisfies it — the same arrangement `ticket:delete` uses. What the UI calls an
 * "agent" is the `admin` role, and it is refused here like everyone else.
 *
 * The deletion is soft: the row stays, `projectScopeWhere` hides it. These tests
 * check both halves — that it disappears from every read, and that it is still
 * on disk for the audit trail to point at.
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

const SUPERUSER = "morgan.lee@acme.com"; // super_admin, Acme
const AGENT = "dana.reyes@acme.com"; // admin — what the UI calls an agent
const REQUESTER = "marcus.chen@acme.com"; // user
const GLOBEX_ADMIN = "nadia.kofi@acme.com"; // super_admin, Globex

/** A project nobody routes through, so it is deletable. */
async function emptyProject(token: string, name = "Scratch"): Promise<number> {
  const res = await request(app)
    .post(`${API}/projects`)
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

async function projectIdByName(name: string): Promise<number> {
  const p = await prisma.project.findFirstOrThrow({ where: { name } });
  return p.id;
}

async function auditRows(action: string) {
  return prisma.auditLog.findMany({ where: { action }, orderBy: { id: "asc" } });
}

beforeEach(async () => {
  await resetDb();
});

describe("DELETE /projects/:id — who may", () => {
  it("lets a super admin delete an empty project", async () => {
    const token = await login(SUPERUSER);
    const id = await emptyProject(token);

    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(token));
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("refuses an agent, and leaves the project untouched", async () => {
    const superuser = await login(SUPERUSER);
    const id = await emptyProject(superuser);

    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(await login(AGENT)));
    expect(res.status).toBe(403);

    // Not merely "still in the list" — nothing on the row moved at all.
    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
    expect(row.deletedById).toBeNull();

    const list = await request(app)
      .get(`${API}/projects`)
      .set(bearer(superuser));
    expect(list.body.data.map((p: { id: number }) => p.id)).toContain(id);
  });

  it("refuses a requester", async () => {
    const id = await emptyProject(await login(SUPERUSER));
    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(await login(REQUESTER)));
    expect(res.status).toBe(403);
  });

  it("answers 401 with no token at all", async () => {
    const id = await emptyProject(await login(SUPERUSER));
    const res = await request(app).delete(`${API}/projects/${id}`);
    expect(res.status).toBe(401);

    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
  });

  it("keeps a super admin inside their own tenant", async () => {
    // Row scope decides WHICH projects, the permission decides WHETHER. Globex's
    // own super admin holds the permission and still cannot reach Acme's row —
    // and gets a 404, not a 403, so the refusal does not confirm it exists.
    const acmeProject = await projectIdByName("Acme Facilities");
    const res = await request(app)
      .delete(`${API}/projects/${acmeProject}`)
      .set(bearer(await login(GLOBEX_ADMIN)));
    expect(res.status).toBe(404);

    const row = await prisma.project.findUniqueOrThrow({ where: { id: acmeProject } });
    expect(row.deletedAt).toBeNull();
  });
});

describe("DELETE /projects/:id — the member guard", () => {
  it("refuses while anyone still routes through it, and names the count", async () => {
    const token = await login(SUPERUSER);
    // Seeded with an owner and two members.
    const id = await projectIdByName("Acme Facilities");

    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROJECT_HAS_MEMBERS");
    expect(res.body.error.message).toMatch(/\d+ members?/);

    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
  });

  it("counts the owner and backup owner, not only listed members", async () => {
    const token = await login(SUPERUSER);
    const dana = await prisma.user.findUniqueOrThrow({
      where: { email: AGENT },
    });
    // A project with nobody in `members`, but an owner — still not empty.
    const id = await emptyProject(token, "Owner only");
    await request(app)
      .patch(`${API}/projects/${id}`)
      .set(bearer(token))
      .send({ ownerId: dana.id })
      .expect(200);

    const impact = await request(app)
      .get(`${API}/projects/${id}/deletion-impact`)
      .set(bearer(token));
    expect(impact.status).toBe(200);
    expect(impact.body.data.members).toBe(1);

    const res = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(token));
    expect(res.status).toBe(409);
  });

  it("succeeds once the members have been moved off", async () => {
    const token = await login(SUPERUSER);
    const id = await projectIdByName("Acme Facilities");

    // Clear the owner, then move every member out — the handover the 409 asks for.
    await request(app)
      .patch(`${API}/projects/${id}`)
      .set(bearer(token))
      .send({ ownerId: null, backupOwnerId: null })
      .expect(200);
    const members = await prisma.user.findMany({ where: { projectId: id } });
    for (const m of members) {
      await request(app)
        .patch(`${API}/users/${m.id}`)
        .set(bearer(token))
        .send({ projectId: null })
        .expect(200);
    }

    await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(token))
      .expect(204);
  });
});

describe("what a deletion leaves behind", () => {
  it("removes it from every read but keeps the row on disk", async () => {
    const token = await login(SUPERUSER);
    const id = await emptyProject(token);
    await request(app).delete(`${API}/projects/${id}`).set(bearer(token)).expect(204);

    // Gone from the list…
    const list = await request(app).get(`${API}/projects`).set(bearer(token));
    expect(list.body.data.map((p: { id: number }) => p.id)).not.toContain(id);
    // …and from a direct read, as a 404 rather than a tombstone.
    await request(app)
      .get(`${API}/projects/${id}`)
      .set(bearer(token))
      .expect(404);

    // But still on disk, stamped with who did it — this is a soft delete.
    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    const morgan = await prisma.user.findUniqueOrThrow({
      where: { email: SUPERUSER },
    });
    expect(row.deletedById).toBe(morgan.id);
  });

  it("cannot be assigned to a user afterwards", async () => {
    // The member picker reads the same scope, but the API is what must refuse:
    // this is the path that would otherwise route someone through a project no
    // screen can show. It goes through `projectScopeWhere` for exactly this.
    const token = await login(SUPERUSER);
    const id = await emptyProject(token);
    await request(app).delete(`${API}/projects/${id}`).set(bearer(token)).expect(204);

    const marcus = await prisma.user.findUniqueOrThrow({
      where: { email: REQUESTER },
    });
    const res = await request(app)
      .patch(`${API}/users/${marcus.id}`)
      .set(bearer(token))
      .send({ projectId: id });
    expect(res.status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: marcus.id } });
    expect(after.projectId).not.toBe(id);
  });

  it("leaves the tickets of its former members alone", async () => {
    const token = await login(SUPERUSER);
    const id = await projectIdByName("Acme Facilities");
    const members = await prisma.user.findMany({ where: { projectId: id } });
    const ticketsBefore = await prisma.ticket.count({
      where: { requesterId: { in: members.map((m) => m.id) }, deletedAt: null },
    });
    expect(ticketsBefore).toBeGreaterThan(0);
    const sample = await prisma.ticket.findFirstOrThrow({
      where: { requesterId: { in: members.map((m) => m.id) }, deletedAt: null },
    });

    await request(app)
      .patch(`${API}/projects/${id}`)
      .set(bearer(token))
      .send({ ownerId: null, backupOwnerId: null })
      .expect(200);
    for (const m of members) {
      await request(app)
        .patch(`${API}/users/${m.id}`)
        .set(bearer(token))
        .send({ projectId: null })
        .expect(200);
    }
    await request(app).delete(`${API}/projects/${id}`).set(bearer(token)).expect(204);

    // Same count, and the individual ticket still opens — no cascade, no orphan.
    const ticketsAfter = await prisma.ticket.count({
      where: { requesterId: { in: members.map((m) => m.id) }, deletedAt: null },
    });
    expect(ticketsAfter).toBe(ticketsBefore);
    const detail = await request(app)
      .get(`${API}/tickets/${sample.id}`)
      .set(bearer(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(sample.id);
  });
});

describe("GET /projects/:id/deletion-impact", () => {
  it("is behind the same permission as the deletion itself", async () => {
    // Telling someone who may not delete how many people a project holds answers
    // the question anyway, so the figure is gated with the action.
    const id = await projectIdByName("Acme Facilities");
    const res = await request(app)
      .get(`${API}/projects/${id}/deletion-impact`)
      .set(bearer(await login(AGENT)));
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  it("reports the same number the guard refuses on", async () => {
    const token = await login(SUPERUSER);
    const id = await projectIdByName("Acme Facilities");

    const impact = await request(app)
      .get(`${API}/projects/${id}/deletion-impact`)
      .set(bearer(token));
    expect(impact.status).toBe(200);
    expect(impact.body.data).toMatchObject({ id, name: "Acme Facilities" });

    const refused = await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(token));
    expect(refused.status).toBe(409);
    // The dialog must not promise one number and the server refuse on another.
    expect(refused.body.error.message).toContain(String(impact.body.data.members));
  });
});

describe("audit trail", () => {
  it("records a successful deletion, readable without the row", async () => {
    const token = await login(SUPERUSER);
    const id = await emptyProject(token, "Doomed");
    await request(app).delete(`${API}/projects/${id}`).set(bearer(token)).expect(204);

    const [row] = await auditRows("project.delete");
    expect(row).toBeDefined();
    expect(row.entity).toBe("project");
    expect(row.entityId).toBe(id);
    const morgan = await prisma.user.findUniqueOrThrow({
      where: { email: SUPERUSER },
    });
    expect(row.userId).toBe(morgan.id);
    // Denormalised: `entityId` is a plain integer with no foreign key, so the
    // name has to travel with the entry or the trail becomes a list of numbers.
    expect(row.meta).toMatchObject({
      name: "Doomed",
      members: 0,
      actorRole: "super_admin",
    });
  });

  it("records a refused attempt too", async () => {
    const id = await emptyProject(await login(SUPERUSER), "Coveted");
    await request(app)
      .delete(`${API}/projects/${id}`)
      .set(bearer(await login(AGENT)))
      .expect(403);

    // The write is fire-and-forget so a failed audit cannot turn a clean 403
    // into a 500; give it a moment to land.
    await new Promise((r) => setTimeout(r, 200));

    const [row] = await auditRows("project.delete_denied");
    expect(row).toBeDefined();
    expect(row.entityId).toBe(id);
    const dana = await prisma.user.findUniqueOrThrow({ where: { email: AGENT } });
    expect(row.userId).toBe(dana.id);
    expect(row.meta).toMatchObject({
      actorRole: "admin",
      permission: "project:delete",
    });

    // And nothing was deleted.
    expect((await auditRows("project.delete")).length).toBe(0);
  });
});
