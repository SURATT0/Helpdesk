import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/modules/auth/auth.password";
import { signAccessToken } from "../src/modules/auth/auth.tokens";
import { mailSender } from "../src/modules/integrations/email/mail-sender";
import { prisma, resetDb } from "./db";

const API = "/api/v1";
const app = createApp();

const DANA = "dana.reyes@acme.com";
const SEED_PASSWORD = "password123";
const NEW_PASSWORD = "a-perfectly-fine-passphrase";

/**
 * Every mail these endpoints tried to send, in order.
 *
 * Spying rather than reading the database, because the raw token exists NOWHERE
 * else: `user_tokens` stores only its SHA-256 hash, which is the property under
 * test as much as anything here. If this spy can recover a working link, so can
 * a person with the mail — and if the table could, a stolen dump would be a set
 * of working links.
 */
type SentMail = { to: string; subject: string; text: string };
let sent: SentMail[] = [];

/** The token out of the most recent mail to `to`, or null if none was sent. */
function tokenFor(to: string): string | null {
  const mail = [...sent].reverse().find((m) => m.to === to);
  if (!mail) return null;
  return /[?&]token=([a-f0-9]+)/.exec(mail.text)?.[1] ?? null;
}

const register = (body: Record<string, unknown>) =>
  request(app).post(`${API}/auth/register`).send(body);

const login = (email: string, password: string) =>
  request(app).post(`${API}/auth/login`).send({ email, password });

const forgot = (email: string) =>
  request(app).post(`${API}/auth/forgot-password`).send({ email });

/**
 * A registration body under an address nothing else has used.
 *
 * Unique per call, because registering the SAME address twice is a different
 * code path by design — the second submission finds an account and mails its
 * owner instead of creating anything. A shared constant would mean every case
 * after the first silently exercised that branch and then failed looking for a
 * token that was never issued.
 */
let newcomerCount = 0;
function newcomer() {
  return {
    email: `newcomer-${++newcomerCount}@example.com`,
    name: "New Comer",
    password: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  };
}

/**
 * A fresh, fully approved account with a known password, under an address no
 * other test uses.
 *
 * The reset cases below CHANGE the password of whatever account they act on, and
 * the database is seeded once for the whole file rather than per test — so
 * pointing them at a seeded user would leave that user's password rewritten for
 * every case that ran afterwards, in this file and in any other that expects the
 * seed's. Each case gets its own throwaway instead.
 */
let fixtureCount = 0;
async function makeApprovedUser(password = SEED_PASSWORD) {
  const email = `reset-fixture-${++fixtureCount}@example.com`;
  await prisma.user.create({
    data: {
      name: "Reset Fixture",
      email,
      role: "user",
      status: "active",
      emailVerifiedAt: new Date(),
      customerId: 1,
      passwordHash: await hashPassword(password),
    },
  });
  return email;
}

beforeAll(async () => {
  await resetDb();
  vi.spyOn(mailSender, "send").mockImplementation(async (mail) => {
    sent.push({ to: mail.to, subject: mail.subject, text: mail.text });
    return { transport: "test", messageId: `<${sent.length}@test>` };
  });
});

beforeEach(() => {
  sent = [];
});

describe("registering is not a way to ask who has an account here", () => {
  it("takes a new address, lands it pending, and mails a confirmation", async () => {
    const NEWCOMER = newcomer();
    const res = await register(NEWCOMER);
    expect(res.status).toBe(202);

    const created = await prisma.user.findFirstOrThrow({
      where: { email: NEWCOMER.email },
    });
    // Pending, unverified, no tenant and no privileges. Each of the four is a
    // separate way this could have gone wrong.
    expect(created.status).toBe("pending");
    expect(created.emailVerifiedAt).toBeNull();
    expect(created.customerId).toBeNull();
    expect(created.role).toBe("user");
    // And a password that is hashed, at the cost the app hashes at — not the
    // seed's cheaper one, and above all not the plaintext.
    expect(created.passwordHash).not.toBe(NEWCOMER.password);
    expect(created.passwordHash).toMatch(/^\$2[aby]\$12\$/);

    expect(tokenFor(NEWCOMER.email)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("writes the confirmation in the language the form was filled in", async () => {
    const NEWCOMER = newcomer();
    await register({ ...NEWCOMER, lang: "en" });
    const english = sent.find((m) => m.to === NEWCOMER.email)?.subject;

    const other = newcomer();
    await register({ ...other, lang: "th" });
    const thai = sent.find((m) => m.to === other.email)?.subject;

    // The regression this guards: `z.object` strips keys it does not declare, so
    // a `lang` the form sends but the validator does not name is silently
    // dropped and every mail goes out in the desk's default — which is Thai, to
    // somebody who just used the app in English.
    expect(english).toBeTruthy();
    expect(thai).toBeTruthy();
    expect(english).not.toBe(thai);
  });

  it("answers a TAKEN address with the same words, and creates nothing", async () => {
    const NEWCOMER = newcomer();
    const before = await prisma.user.count();
    const fresh = await register({ ...NEWCOMER, email: DANA });
    expect(fresh.status).toBe(202);
    expect(await prisma.user.count()).toBe(before);
    // The reply is the thing that must not differ. If these two ever diverge,
    // the public form has become a membership oracle for the whole desk.
    const other = await register({ ...NEWCOMER, email: "nobody@example.com" });
    expect(fresh.body).toEqual(other.body);
  });

  it("stays uniform when two registrations of one address race", async () => {
    const NEWCOMER = newcomer();
    // Submitting twice at once is how the lookup-then-insert check is defeated:
    // for a FREE address one insert wins and the other hits the unique index, so
    // without the collision being absorbed the pair answers 202 + 409 — while a
    // TAKEN address answers 202 twice. The difference between those two pairs is
    // the enumeration the uniform reply exists to refuse.
    const [a, b] = await Promise.all([
      register(NEWCOMER),
      register(NEWCOMER),
    ]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(b.body);
    // Exactly one account, whichever request won.
    expect(await prisma.user.count({ where: { email: NEWCOMER.email } })).toBe(1);
  });

  it("tells the real owner instead, which is who is entitled to know", async () => {
    const NEWCOMER = newcomer();
    await register({ ...NEWCOMER, email: DANA });
    const mail = sent.find((m) => m.to === DANA);
    expect(mail).toBeDefined();
    // No token in it: nothing was created, so there is nothing to confirm, and a
    // link here would let a stranger trigger mail carrying a live credential.
    expect(mail?.text).not.toMatch(/token=/);
    expect(tokenFor(DANA)).toBeNull();
  });

  it("refuses a mismatched confirmation and a short password, on the server", async () => {
    const NEWCOMER = newcomer();
    const mismatch = await register({
      ...NEWCOMER,
      email: "mismatch@example.com",
      confirmPassword: "something-else-entirely",
    });
    expect(mismatch.status).toBe(400);

    const weak = await register({
      email: "weak@example.com",
      name: "Weak",
      password: "short",
      confirmPassword: "short",
    });
    expect(weak.status).toBe(400);

    expect(
      await prisma.user.count({
        where: { email: { in: ["mismatch@example.com", "weak@example.com"] } },
      }),
    ).toBe(0);
  });
});

describe("a pending account sees nothing at all", () => {
  it("cannot sign in, and is told the one step that is its own to take", async () => {
    const NEWCOMER = newcomer();
    await register(NEWCOMER);
    const res = await login(NEWCOMER.email, NEWCOMER.password);
    expect(res.status).toBe(401);
    // The password was right — saying so is not a leak (they proved they own the
    // account) and the alternative sends them to reset a password that works.
    expect(res.body.error.message).toMatch(/confirm your email/i);
  });

  it("is refused every authenticated route even holding a valid signed token", async () => {
    const NEWCOMER = newcomer();
    await register(NEWCOMER);
    const pending = await prisma.user.findFirstOrThrow({
      where: { email: NEWCOMER.email },
    });

    // Minted directly, because sign-in will not issue one — which is the point.
    // This is the defence-in-depth check: if a token for a pending account ever
    // reaches the API (a status changed after signing, a bug in a future issue
    // path), `requireAuth` still refuses it.
    const token = signAccessToken({
      id: pending.id,
      name: pending.name,
      email: pending.email,
      role: pending.role,
      status: pending.status,
      teamId: null,
      department: null,
      customerId: pending.customerId,
      customerIds: [],
    });

    // One route per shape of thing the API exposes: their own resources, a
    // listing, the dashboard, and the session endpoint itself.
    for (const path of ["/tickets", "/customers", "/dashboard/summary", "/auth/me"]) {
      const res = await request(app)
        .get(`${API}${path}`)
        .set("Authorization", `Bearer ${token}`);
      expect(
        res.status,
        `${path} let a pending account through with ${res.status}`,
      ).toBe(403);
    }
  });

  it("confirming the address does NOT approve the account", async () => {
    const NEWCOMER = newcomer();
    await register(NEWCOMER);
    const token = tokenFor(NEWCOMER.email);
    const verified = await request(app)
      .post(`${API}/auth/verify-email`)
      .send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe("pending");

    const row = await prisma.user.findFirstOrThrow({
      where: { email: NEWCOMER.email },
    });
    // The address is proven; the decision has still not been made by anyone.
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.status).toBe("pending");

    // And the message changes to the step that is no longer theirs.
    const res = await login(NEWCOMER.email, NEWCOMER.password);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/approve/i);
  });

  it("works the moment a person approves it, and not before", async () => {
    const NEWCOMER = newcomer();
    await register(NEWCOMER);
    await request(app)
      .post(`${API}/auth/verify-email`)
      .send({ token: tokenFor(NEWCOMER.email) });

    // Stands in for the approval queue, which lands with the admin UI. What is
    // under test here is that `status` is the ONLY thing between this account and
    // a session — nothing else needs changing.
    await prisma.user.updateMany({
      where: { email: NEWCOMER.email },
      data: { status: "active", customerId: 1 },
    });

    const res = await login(NEWCOMER.email, NEWCOMER.password);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it("burns a confirmation link on first use", async () => {
    const NEWCOMER = newcomer();
    await register(NEWCOMER);
    const token = tokenFor(NEWCOMER.email);
    expect((await request(app).post(`${API}/auth/verify-email`).send({ token })).status).toBe(200);
    const again = await request(app).post(`${API}/auth/verify-email`).send({ token });
    expect(again.status).toBe(400);
  });
});

describe("forgot password says the same sentence to everyone", () => {
  it("answers identically for a real address, an unknown one, and a bad one", async () => {
    const real = await forgot(DANA);
    const unknown = await forgot("nobody-at-all@example.com");
    expect(real.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(real.body).toEqual(unknown.body);
    // Only one of the two actually produced a link.
    expect(tokenFor(DANA)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenFor("nobody-at-all@example.com")).toBeNull();
  });

  it("refuses an account that has never had a password, silently", async () => {
    // Exactly the row email intake creates for a stranger who writes in. Without
    // this guard, mailing the desk would be enough to have an account made and
    // then reset your way into that customer's tenant.
    const correspondent = await prisma.user.create({
      data: {
        name: "Wrote In",
        email: "wrote-in@example.com",
        role: "user",
        status: "active",
        passwordHash: null,
        customerId: 1,
      },
    });

    const res = await forgot(correspondent.email);
    expect(res.status).toBe(200);
    expect(res.body).toEqual((await forgot(DANA)).body);
    // No link, and no row that could later become one.
    expect(tokenFor(correspondent.email)).toBeNull();
    expect(
      await prisma.userToken.count({ where: { userId: correspondent.id } }),
    ).toBe(0);
  });

  it("replaces the previous link rather than adding to it", async () => {
    const email = await makeApprovedUser();
    await forgot(email);
    const first = tokenFor(email);
    sent = [];
    await forgot(email);
    const second = tokenFor(email);
    expect(second).not.toBe(first);

    // Asking again refreshes the window; it must not widen it by leaving five
    // working links in one inbox.
    const reset = (token: string | null) =>
      request(app).post(`${API}/auth/reset-password`).send({
        token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });
});

describe("a reset link works once, then closes every door behind it", () => {
  const reset = (token: string | null, password = NEW_PASSWORD) =>
    request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password, confirmPassword: password });

  it("sets the new password, retires the old one, and cannot be replayed", async () => {
    const email = await makeApprovedUser();
    await forgot(email);
    const token = tokenFor(email);

    expect((await reset(token)).status).toBe(200);
    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(email, SEED_PASSWORD)).status).toBe(401);
    // Single use. The row is matched on `used_at IS NULL`, so this is refused by
    // the database and not only by the check above it.
    expect((await reset(token)).status).toBe(400);
  });

  it("signs out every session the account already had", async () => {
    const email = await makeApprovedUser();
    // A session established BEFORE the reset — the one belonging to whoever
    // prompted it. If this survives, the reset was theatre.
    const before = await login(email, SEED_PASSWORD);
    const cookie = before.headers["set-cookie"];
    expect((await request(app).post(`${API}/auth/refresh`).set("Cookie", cookie)).status).toBe(200);

    await forgot(email);
    await reset(tokenFor(email));

    const after = await request(app)
      .post(`${API}/auth/refresh`)
      .set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("does not hand back a session of its own", async () => {
    const email = await makeApprovedUser();
    await forgot(email);
    const res = await reset(tokenFor(email));
    // Signing them in here would undo the half of the guarantee that matters.
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses an expired link", async () => {
    const email = await makeApprovedUser();
    await forgot(email);
    const token = tokenFor(email);
    await prisma.userToken.updateMany({
      where: { usedAt: null, purpose: "password_reset" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await reset(token)).status).toBe(400);
    // The old password still works — an expired link must not have half-applied.
    expect((await login(email, SEED_PASSWORD)).status).toBe(200);
  });

  it("refuses a forged token and a mismatched confirmation", async () => {
    expect((await reset("f".repeat(64))).status).toBe(400);

    const email = await makeApprovedUser();
    await forgot(email);
    const token = tokenFor(email);
    const mismatch = await request(app).post(`${API}/auth/reset-password`).send({
      token,
      password: NEW_PASSWORD,
      confirmPassword: "not-the-same-thing",
    });
    expect(mismatch.status).toBe(400);
    // Rejected before the token was spent, so the person can try again.
    expect((await reset(token)).status).toBe(200);
  });
});
