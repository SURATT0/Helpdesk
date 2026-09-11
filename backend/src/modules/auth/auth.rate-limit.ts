import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Which bucket a login attempt is counted against.
 *
 * The usual answer is the caller's address, and it stopped being available: the
 * web app proxies `/api/v1` to this API, so every login arrives from the web
 * server. One bucket then covers the whole site, and the guard turns into a
 * weapon — twenty wrong passwords from one person lock everybody out for
 * fifteen minutes. `trust proxy` does not recover the caller either. Measured
 * on Next 15.5: the rewrite adds no `X-Forwarded-For` of its own and forwards a
 * client-supplied one unchanged, so Express would be reading an address the
 * caller wrote and anyone could mint themselves fresh buckets.
 *
 * So the budget belongs to the ACCOUNT it protects. Guessing at one person's
 * password never touches anyone else's ability to sign in, and it holds however
 * the request reached us — direct, proxied, or through a tunnel.
 *
 * The trade, stated plainly: someone who knows an address can burn that
 * account's own window and keep its owner out for fifteen minutes. That is a
 * nuisance aimed at one person, where the per-IP version behind a proxy was an
 * outage for all of them. What neither shape catches is one password tried
 * against thousands of accounts — a single guess each stays under every
 * per-account budget — and no address-based limit would catch it here either,
 * because there is no address to count.
 *
 * Normalised before bucketing, because case and padding are the attacker's to
 * choose: `Dana@ACME.com ` must not be a fresh budget. Prisma's lookup is
 * case-sensitive, so this can only ever merge buckets, never split one.
 */
export function loginRateKey(req: Request): string {
  const email = (req.body as { email?: unknown } | null | undefined)?.email;
  if (typeof email === "string" && email.trim() !== "") {
    return `email:${email.trim().toLowerCase()}`;
  }
  // No account named — a malformed or empty body, which the validator will
  // reject in a moment. Nothing to protect, so fall back to the address;
  // `ipKeyGenerator` masks IPv6 to a subnet so one client cannot walk its own
  // /64 for unlimited buckets.
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/**
 * Brute-force guard on the credential endpoint. `limit` failed attempts per
 * account per 15 minutes.
 *
 * FAILED attempts, deliberately: a successful sign-in is not evidence of
 * anything and must never spend the budget. Several people sharing an account,
 * or one person on several devices, would otherwise lock it by using it — and
 * the E2E suite, which signs in on nearly every spec, would trip a limit meant
 * for attackers.
 */
export function createLoginLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: loginRateKey,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts, try again later",
      },
    },
  });
}

/**
 * Guard on the two other endpoints that take an address from an anonymous
 * caller: registration and the password-reset request.
 *
 * Same key as login — the address in the body, via `loginRateKey` — and for the
 * same unavoidable reason: behind the web app's proxy there is no caller address
 * to count, so the account is the only bucket available.
 *
 * `skipSuccessfulRequests` is deliberately NOT set here, and that is the
 * difference from login. Both of these endpoints answer 200 whether or not they
 * did anything — that uniformity is what stops them being enumeration oracles —
 * so "successful" carries no information, and skipping successes would mean
 * skipping every request and limiting nothing at all. Here the budget is spent
 * by ASKING, which is also the right shape for what these need to prevent:
 * somebody hammering one person's inbox with reset links, each of which is a
 * perfectly successful request.
 *
 * What it does not stop, said plainly: a script registering a thousand different
 * addresses, since each address is its own budget. The approval queue is the
 * defence against that — none of those accounts sees anything until a person
 * says so.
 */
export function createAccountRequestLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: loginRateKey,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts, try again later",
      },
    },
  });
}
