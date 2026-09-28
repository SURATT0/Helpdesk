import type { NextFunction, Request, Response } from "express";
import rateLimit, { ipKeyGenerator, MemoryStore } from "express-rate-limit";
import { env } from "../../config/env";

/**
 * One store per limiter, held onto (rather than left to the default each
 * `rateLimit()` call would create internally) so `resetIntakeRateLimitsForTesting`
 * can clear all three between test cases — the limit VALUE is already
 * re-read live from `env` on every request (see the `limit: () =>` functions
 * below), but the accumulated COUNT for a given key is a separate thing a
 * lowered limit does not retroactively fix.
 */
const ipMinuteStore = new MemoryStore();
const ipHourStore = new MemoryStore();
const emailHourStore = new MemoryStore();

/** Test-only: clears accumulated counts so one test's traffic cannot spill into the next. Never called from production code. */
export function resetIntakeRateLimitsForTesting(): void {
  void ipMinuteStore.resetAll();
  void ipHourStore.resetAll();
  void emailHourStore.resetAll();
}

/**
 * The public contract's own 429 shape (design doc §05) — `{"error":"rate_limited",
 * "retryAfter":<seconds>}` — never the internal `{error:{code,message}}`
 * envelope every authenticated endpoint answers with. This whole module
 * exists because express-rate-limit's default `message` is static; the
 * retry-after SECONDS in the body have to be computed per request from
 * whichever window rejected it.
 */
function rateLimited(req: Request, res: Response, _next: NextFunction): void {
  // express-rate-limit attaches this at runtime (default property name
  // "rateLimit") but does not merge it into Express's Request type.
  const resetTime = (req as unknown as { rateLimit?: { resetTime?: Date } })
    .rateLimit?.resetTime;
  const retryAfter = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : 60;
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ error: "rate_limited", retryAfter });
}

/**
 * Per-IP, per-minute — the burst guard (design doc §09, RATE_LIMIT_PER_MIN).
 *
 * `ipKeyGenerator` rather than `req.ip` directly: it masks an IPv6 address to
 * a /64 subnet, so one client cannot dodge the limit by cycling through
 * addresses inside its own block. Unlike the auth limiters in
 * auth.rate-limit.ts, the caller's address IS usable here — this endpoint is
 * hit directly by the intake form (same origin or CORS), never proxied
 * through the Next.js web app the way `/api/v1/auth/*` is, so there is no
 * rewrite silently discarding the real address before Express sees it. If a
 * reverse proxy is ever placed in front of this route too, `trust proxy` and
 * this key both need revisiting together.
 */
export const intakeIpMinuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: () => env.publicIntake.rateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: rateLimited,
  store: ipMinuteStore,
});

/** Per-IP, per-hour — the ceiling behind the burst guard (RATE_LIMIT_PER_HOUR). */
export const intakeIpHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => env.publicIntake.rateLimitPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: rateLimited,
  store: ipHourStore,
});

/**
 * Per business email, per hour — the IP limiters' blind spot: a script
 * rotating source addresses but naming one victim's inbox in every request
 * (design doc §09, "จำกัดต่อ...ต่ออีเมล"). Runs AFTER the body is parsed
 * (multer for multipart, express.json for JSON — see intake.routes.ts for the
 * order), so it reads whatever `businessEmail` was actually sent; a missing
 * or non-string value buckets under a single shared key rather than skipping
 * the limiter, so a body crafted to omit the field cannot dodge it entirely.
 *
 * Normalised the same way `loginRateKey` normalises an account address —
 * case and surrounding whitespace are the sender's to choose, not a way to
 * mint fresh buckets.
 */
export const intakeEmailHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => env.publicIntake.rateLimitPerEmailPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const raw = (req.body as { businessEmail?: unknown } | undefined)
      ?.businessEmail;
    return typeof raw === "string" && raw.trim() !== ""
      ? `email:${raw.trim().toLowerCase()}`
      : "email:(none)";
  },
  handler: rateLimited,
  store: emailHourStore,
});
