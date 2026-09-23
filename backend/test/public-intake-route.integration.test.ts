import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { resetIntakeRateLimitsForTesting } from "../src/modules/publicIntake/intake.rate-limit";
import { prisma, resetDb } from "./db";

/**
 * The public HTTP surface (step 6): the route itself needs no auth, its own
 * CORS policy is separate from the credentialed main-API one, and both
 * rate limiters actually gate the endpoint. The write-path behaviour itself
 * (validation, persistence, email) is covered by the other public-intake
 * integration suites — this file is about the ROUTE.
 */

const app = createApp();
const API = "/api/v1/public/tickets";

const VALID = {
  name: "สุรัตน์ ใจดี",
  companyName: "บริษัท ตัวอย่าง จำกัด",
  phone: "081-234-5678",
  service: "rpa-consult",
  message: "อยากปรึกษาเรื่องวางระบบ RPA ให้ทีมงานติดต่อกลับด้วยครับ",
  consent: true,
  source: "web-intake-form",
  submittedAt: "2026-09-21T09:30:00.000Z",
};

beforeEach(async () => {
  await resetDb();
  // Every test in this file POSTs from the same loopback address, so the
  // rate limiters' accumulated counts would otherwise carry from one test
  // into the next regardless of resetDb (which only touches the database).
  resetIntakeRateLimitsForTesting();
});

describe("no authentication required", () => {
  it("accepts a submission with no Authorization header at all", async () => {
    const res = await request(app)
      .post(API)
      .send({ ...VALID, businessEmail: "route1@no-such-domain-example.test" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "received" });
    expect(res.body.ticketNumber).toMatch(/^BF-\d{8}-\d{4}$/);
  });
});

describe("the documented public wire contract (design doc §05)", () => {
  it("422s a missing consent, exactly {error: consent_required}", async () => {
    const { consent: _drop, ...withoutConsent } = VALID;
    const res = await request(app)
      .post(API)
      .send({ ...withoutConsent, businessEmail: "route2@no-such-domain-example.test" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "consent_required" });
  });

  it("400s a bad field with {error: validation, fields: {...}}", async () => {
    const res = await request(app)
      .post(API)
      .send({ ...VALID, businessEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation");
    expect(res.body.fields.businessEmail).toBeDefined();
  });

  it("201s a honeypot hit with a fake-looking number, and writes no ticket", async () => {
    const before = await prisma.ticket.count();
    const res = await request(app)
      .post(API)
      .send({
        ...VALID,
        businessEmail: "bot@no-such-domain-example.test",
        website: "http://spam.example",
      });
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^BF-\d{8}-\d{4}$/);
    expect(await prisma.ticket.count()).toBe(before);
    const spam = await prisma.intakeSubmission.findFirstOrThrow({
      where: { businessEmail: "bot@no-such-domain-example.test" },
    });
    expect(spam.status).toBe("spam");
  });

  it("415s a file whose bytes contradict its declared type", async () => {
    const res = await request(app)
      .post(API)
      .field("name", VALID.name)
      .field("businessEmail", "route3@no-such-domain-example.test")
      .field("companyName", VALID.companyName)
      .field("phone", VALID.phone)
      .field("service", VALID.service)
      .field("message", VALID.message)
      .field("consent", "true")
      .field("source", VALID.source)
      .field("submittedAt", VALID.submittedAt)
      .attach("attachments", Buffer.from("MZ\x00\x00fake exe"), {
        filename: "photo.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: "unsupported_type" });
  });

  it("201s a genuine multipart submission with a valid attachment", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const res = await request(app)
      .post(API)
      .field("name", VALID.name)
      .field("businessEmail", "route4@no-such-domain-example.test")
      .field("companyName", VALID.companyName)
      .field("phone", VALID.phone)
      .field("service", VALID.service)
      .field("message", VALID.message)
      .field("consent", "true")
      .field("source", VALID.source)
      .field("submittedAt", VALID.submittedAt)
      .attach("attachments", png, { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const attachment = await prisma.attachment.findFirstOrThrow({
      where: { ticket: { number: res.body.ticketNumber } },
    });
    expect(attachment.scanStatus).toBe("pending");
  });
});

describe("CORS — separate from, and never widening, the credentialed main-API policy", () => {
  const originalFormOrigin = env.publicIntake.formOrigin;
  afterEach(() => {
    env.publicIntake.formOrigin = originalFormOrigin;
  });

  it("sets no Access-Control-Allow-Origin at all when PUBLIC_FORM_ORIGIN is unset", async () => {
    env.publicIntake.formOrigin = undefined;
    const res = await request(app)
      .options(API)
      .set("Origin", "https://bluefishsolution.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("grants the configured origin once PUBLIC_FORM_ORIGIN is set", async () => {
    env.publicIntake.formOrigin = "https://bluefishsolution.com";
    const res = await request(app)
      .options(API)
      .set("Origin", "https://bluefishsolution.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://bluefishsolution.com",
    );
  });

  it("never sets Access-Control-Allow-Credentials — this endpoint carries no cookie", async () => {
    env.publicIntake.formOrigin = "https://bluefishsolution.com";
    const res = await request(app)
      .options(API)
      .set("Origin", "https://bluefishsolution.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("leaves the main API's own credentialed CORS answering for its own routes", async () => {
    const res = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", env.webOrigin)
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("rate limiting — per IP and per email (design doc §09)", () => {
  const originalPerMinute = env.publicIntake.rateLimitPerMinute;
  const originalPerEmail = env.publicIntake.rateLimitPerEmailPerHour;
  afterEach(() => {
    env.publicIntake.rateLimitPerMinute = originalPerMinute;
    env.publicIntake.rateLimitPerEmailPerHour = originalPerEmail;
  });

  it("429s once the per-IP per-minute budget is spent, with a retryAfter", async () => {
    env.publicIntake.rateLimitPerMinute = 2;
    const send = (email: string) =>
      request(app).post(API).send({ ...VALID, businessEmail: email });

    expect((await send("burst1@no-such-domain-example.test")).status).toBe(201);
    expect((await send("burst2@no-such-domain-example.test")).status).toBe(201);
    const third = await send("burst3@no-such-domain-example.test");
    expect(third.status).toBe(429);
    expect(third.body.error).toBe("rate_limited");
    expect(typeof third.body.retryAfter).toBe("number");
  });

  it("429s a script hammering ONE email address, even across different IPs", async () => {
    env.publicIntake.rateLimitPerMinute = 1000; // isolate the email limiter
    env.publicIntake.rateLimitPerEmailPerHour = 2;
    const send = () =>
      request(app)
        .post(API)
        .send({ ...VALID, businessEmail: "hammered@no-such-domain-example.test" });

    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const third = await send();
    expect(third.status).toBe(429);
  });
});

describe("the static form", () => {
  it("serves index.html at /intake with the API endpoint as a relative path", async () => {
    const res = await request(app).get("/intake/");
    expect(res.status).toBe(200);
    // Asserted against the same `API` this file's own requests use, not a
    // hand-copied literal — the form's ENDPOINT drifting one prefix segment
    // away from where the route is actually mounted (as it once did: a
    // "/api/public/tickets" that 404s against the real "/api/v1/public/tickets"
    // mount) is exactly the silent breakage a hardcoded string here would
    // have kept missing.
    expect(res.text).toContain(`const ENDPOINT = "${API}"`);
  });
});
