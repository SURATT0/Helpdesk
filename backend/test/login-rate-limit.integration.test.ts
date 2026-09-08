import express from "express";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { asyncHandler, errorHandler } from "../src/middlewares";
import { authController } from "../src/modules/auth/auth.controller";
import { createLoginLimiter } from "../src/modules/auth/auth.rate-limit";
import { resetDb } from "./db";

const API = "/api/v1";
const app = createApp();

const DANA = "dana.reyes@acme.com";
const MARCUS = "marcus.chen@acme.com";
const PASSWORD = "password123";

const login = (target: express.Express, email: string, password: string) =>
  request(target).post(`${API}/auth/login`).send({ email, password });

const remaining = (res: { headers: Record<string, unknown> }) =>
  Number(res.headers["ratelimit-remaining"]);

beforeAll(async () => {
  await resetDb();
});

/**
 * The guard is keyed on the account being tried, because behind the web app's
 * /api/v1 proxy every login reaches this API from the web server and an
 * address-keyed window would be one window for the whole site.
 *
 * These read the budget off the `RateLimit-Remaining` header rather than by
 * exhausting it, so they say what is counted against whom without depending on
 * how large the limit happens to be.
 */
describe("the login guard spends one account's budget, never another's", () => {
  it("counts a failed attempt against the account that was tried", async () => {
    const first = await login(app, DANA, "wrong-password");
    expect(first.status).toBe(401);
    const second = await login(app, DANA, "also-wrong");
    expect(second.status).toBe(401);
    // Same account, same bucket: the second attempt cost one more than the first.
    expect(remaining(second)).toBe(remaining(first) - 1);
  });

  it("leaves every other account untouched", async () => {
    // This is the regression the proxy introduced and this keying removes: both
    // requests arrive from the same address, so only the account can separate
    // them. Marcus has spent nothing, so his budget is still whole.
    const dana = await login(app, DANA, "wrong-password");
    const marcus = await login(app, MARCUS, "wrong-password");
    expect(marcus.status).toBe(401);
    expect(remaining(marcus)).toBeGreaterThan(remaining(dana));

    const limit = Number(marcus.headers["ratelimit-limit"]);
    expect(remaining(marcus)).toBe(limit - 1);
  });

  it("does not treat a change of case or padding as a fresh budget", async () => {
    const plain = await login(app, MARCUS, "wrong-password");
    const dressed = await login(app, `  ${MARCUS.toUpperCase()}  `, "wrong-password");
    expect(remaining(dressed)).toBe(remaining(plain) - 1);
  });

  it("never spends the budget on a successful sign-in", async () => {
    // Signing in is not evidence of an attack. If it counted, a shared account —
    // or one person on several devices — would lock itself out by being used.
    const before = await login(app, DANA, "wrong-password");
    const ok = await login(app, DANA, PASSWORD);
    expect(ok.status).toBe(200);
    const after = await login(app, DANA, "wrong-password");
    expect(after.status).toBe(401);
    expect(remaining(after)).toBe(remaining(before) - 1);
  });
});

/**
 * What happens at the ceiling. The real app runs a limit far above anything a
 * test should sit and spend, so this mounts the same limiter and the same
 * controller with a budget of two.
 */
describe("at the ceiling, only the account being guessed at is shut out", () => {
  const small = express();
  small.use(express.json());
  small.post(`${API}/auth/login`, createLoginLimiter(2), asyncHandler(authController.login));
  small.use(errorHandler);

  it("refuses the third failed attempt on that account, and lets everyone else in", async () => {
    expect((await login(small, DANA, "wrong-password")).status).toBe(401);
    expect((await login(small, DANA, "wrong-password")).status).toBe(401);

    const blocked = await login(small, DANA, "wrong-password");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");

    // Dana's own correct password is refused too — that is the guard working,
    // and it is the cost of keying on the account.
    expect((await login(small, DANA, PASSWORD)).status).toBe(429);

    // Everyone else is unaffected. Under the old per-IP key behind the proxy,
    // this would have been a 429 as well: one person's typos, everybody's outage.
    const marcus = await login(small, MARCUS, PASSWORD);
    expect(marcus.status).toBe(200);
    expect(marcus.body.data.accessToken).toBeTypeOf("string");
  });
});
