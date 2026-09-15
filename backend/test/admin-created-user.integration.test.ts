import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, resetDb, tenantSuperAdmin } from "./db";

/**
 * Accounts an administrator creates, and the password they are handed.
 *
 * Two things are under test and they are not the same thing. The first is who
 * may create an account at all — the same gate approving a registration uses,
 * because both acts choose somebody's tenant. The second is what the handed-over
 * password can DO, which is the part that makes "temporary" mean something: it
 * has been spoken aloud or typed into a chat by the time it reaches its owner,
 * so an account still holding it must not be able to read a ticket with it.
 *
 * The second half is asserted by trying real routes rather than by reading the
 * flag back, because the flag is not the guarantee — `requireAuth` is, and a
 * flag nothing enforced would pass a test that read the column.
 */

const app = createApp();
const API = "/api/v1";

const PLATFORM = "sam.rivera@acme.com"; // super_admin, no customer → platform-wide
const ACME_ADMIN = "dana.reyes@acme.com"; // admin, inside Acme
const PASSWORD = "password123";
const HANDED_OVER = "handed-over-for-now";
const CHOSEN = "one-only-i-know-now";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app)
    .post(`${API}/auth/login`)
    .send({ email, password });
  expect(res.status, `${email} could not sign in`).toBe(200);
  return res.body.data.accessToken as string;
}

async function acmeId(): Promise<number> {
  const c = await prisma.customer.findFirstOrThrow({
    where: { name: "Acme Corp" },
  });
  return c.id;
}

/**
 * A fresh address per call. The database is seeded once for the file, and a
 * shared address would make every case after the first exercise the duplicate
 * branch instead of the one it is about.
 */
let n = 0;
const freshEmail = () => `created-${++n}@example.com`;

async function createUser(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post(`${API}/users`)
    .set(bearer(token))
    .send({
      name: "Newly Created",
      email: freshEmail(),
      password: HANDED_OVER,
      role: "user",
      customerId: await acmeId(),
      ...overrides,
    });
}

beforeEach(async () => {
  await resetDb();
});

describe("who may create an account", () => {
  it("lets a platform-wide super admin create one", async () => {
    const res = await createUser(await login(PLATFORM));
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe("user");
    expect(res.body.data.customer.name).toBe("Acme Corp");
  });

  it("refuses a super admin who belongs to a customer", async () => {
    // The gate is reach, not role: this account holds the top role and is still
    // refused, which is the whole distinction `isPlatformWide` draws.
    const confined = await tenantSuperAdmin("Acme Corp");
    const res = await createUser(await login(confined.email, confined.password));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PLATFORM_STAFF_ONLY");
  });

  it("refuses an admin", async () => {
    const res = await createUser(await login(ACME_ADMIN));
    expect(res.status).toBe(403);
  });
});

describe("the account that comes out", () => {
  it("is active and confirmed, so nobody has to wait for mail", async () => {
    const res = await createUser(await login(PLATFORM));
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    // Both gates that hold a self-registration back are already settled: a named
    // administrator vouched for the address, which is the stronger claim of the
    // two the link and the approval make.
    expect(row.status).toBe("active");
    expect(row.emailVerifiedAt).not.toBeNull();
    // And the third thing, which is the point of this feature.
    expect(row.mustChangePasswordAt).not.toBeNull();
  });

  it("stores the address lowercased, so it can be signed in with", async () => {
    const token = await login(PLATFORM);
    const mixed = `Mixed-Case-${++n}@Example.com`;
    const res = await createUser(token, { email: mixed });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(mixed.toLowerCase());
    // The trap: `login` looks the address up lowercased, so an account stored
    // with capitals is one nobody can ever sign in to.
    await login(mixed, HANDED_OVER);
  });

  it("names the address when it already has an account", async () => {
    const token = await login(PLATFORM);
    const email = freshEmail();
    expect((await createUser(token, { email })).status).toBe(201);

    const second = await createUser(token, { email });
    expect(second.status).toBe(400);
    // Named rather than uniform, unlike the public sign-up form: this endpoint
    // is platform-wide only and its caller can already list every account.
    expect(second.body.error.message).toContain(email);
  });

  it("holds the handed-over password to the same rule as a chosen one", async () => {
    const res = await createUser(await login(PLATFORM), { password: "short" });
    expect(res.status).toBe(400);
  });

  it("refuses a customer that does not exist", async () => {
    const res = await createUser(await login(PLATFORM), { customerId: 99_999 });
    expect(res.status).toBe(400);
  });
});

describe("what the handed-over password can do", () => {
  async function createdAccount() {
    const email = freshEmail();
    const res = await createUser(await login(PLATFORM), { email });
    expect(res.status).toBe(201);
    return { email, id: res.body.data.id as number };
  }

  it("signs in — the password is real", async () => {
    const { email } = await createdAccount();
    await login(email, HANDED_OVER);
  });

  it("and then reaches nothing", async () => {
    const { email } = await createdAccount();
    const token = await login(email, HANDED_OVER);

    // Not one route: a sample across modules, because the guarantee is that the
    // gate is in `requireAuth` rather than on routes somebody remembered.
    for (const path of ["/tickets", "/users", "/dashboard", "/reports/summary"]) {
      const res = await request(app).get(`${API}${path}`).set(bearer(token));
      expect(res.status, `${path} was reachable`).toBe(403);
      expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("can still read who it is, or the form has nothing to render", async () => {
    const { email } = await createdAccount();
    const token = await login(email, HANDED_OVER);
    const res = await request(app).get(`${API}/auth/me`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.mustChangePassword).toBe(true);
  });

  it("says so on the session it hands back at sign-in", async () => {
    const { email } = await createdAccount();
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: HANDED_OVER });
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });
});

describe("replacing it", () => {
  async function signedInAsCreated() {
    const email = freshEmail();
    expect((await createUser(await login(PLATFORM), { email })).status).toBe(201);
    return { email, token: await login(email, HANDED_OVER) };
  }

  const change = (token: string, body: Record<string, unknown>) =>
    request(app)
      .post(`${API}/auth/change-password`)
      .set(bearer(token))
      .send(body);

  it("refuses the wrong current password", async () => {
    const { token } = await signedInAsCreated();
    const res = await change(token, {
      currentPassword: "not-the-one",
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });
    expect(res.status).toBe(401);
  });

  it("refuses the same password again", async () => {
    // Otherwise the flag clears while the secret it exists to retire stays in
    // place — the one refusal here that is about more than tidiness.
    const { token } = await signedInAsCreated();
    const res = await change(token, {
      currentPassword: HANDED_OVER,
      password: HANDED_OVER,
      confirmPassword: HANDED_OVER,
    });
    expect(res.status).toBe(400);
  });

  it("refuses a mismatched confirmation", async () => {
    const { token } = await signedInAsCreated();
    const res = await change(token, {
      currentPassword: HANDED_OVER,
      password: CHOSEN,
      confirmPassword: `${CHOSEN}-typo`,
    });
    expect(res.status).toBe(400);
  });

  it("opens the desk, and the new session is not flagged", async () => {
    const { token } = await signedInAsCreated();
    const res = await change(token, {
      currentPassword: HANDED_OVER,
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(false);

    // The session handed back works where the old one was refused.
    const after = await request(app)
      .get(`${API}/tickets`)
      .set(bearer(res.body.data.accessToken));
    expect(after.status).toBe(200);
  });

  it("leaves the old password unusable and the new one working", async () => {
    const { email, token } = await signedInAsCreated();
    await change(token, {
      currentPassword: HANDED_OVER,
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });

    const old = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: HANDED_OVER });
    expect(old.status).toBe(401);

    await login(email, CHOSEN);
  });

  it("ends every other session the account had", async () => {
    // The sharp edge of this feature: the password being replaced is one
    // somebody else knew, so a session opened with it elsewhere has to stop.
    const { email, token } = await signedInAsCreated();
    const elsewhere = await login(email, HANDED_OVER);

    await change(token, {
      currentPassword: HANDED_OVER,
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });

    const refreshRows = await prisma.refreshToken.findMany({
      where: { user: { email }, revokedAt: null },
    });
    // Exactly one lives: the session the change itself minted.
    expect(refreshRows).toHaveLength(1);
    // The other access token outlives its refresh token by up to fifteen
    // minutes — that lag is the design, and the flag on it is still true, so it
    // reaches nothing in the meantime either.
    const res = await request(app).get(`${API}/tickets`).set(bearer(elsewhere));
    expect(res.status).toBe(403);
  });

  it("is available to anybody, not only a handed-over account", async () => {
    // The desk had no self-service password change at all before this, only the
    // emailed reset link — useless on a deployment whose mail cannot leave.
    const token = await login(ACME_ADMIN);
    const res = await change(token, {
      currentPassword: PASSWORD,
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });
    expect(res.status).toBe(200);
    await login(ACME_ADMIN, CHOSEN);
  });
});
