import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { loginRateKey } from "./auth.rate-limit";

const req = (body: unknown, ip = "10.0.0.7") =>
  ({ body, ip }) as unknown as Request;

describe("loginRateKey", () => {
  it("gives each account its own budget", () => {
    // The point of the whole change: one person's failed logins must not spend
    // anyone else's. Behind the web app's proxy both requests arrive from the
    // same address, so the address cannot be what separates them.
    const a = loginRateKey(req({ email: "dana.reyes@acme.com" }));
    const b = loginRateKey(req({ email: "marcus.chen@acme.com" }));
    expect(a).not.toBe(b);
  });

  it("keys on the account, not the address it came from", () => {
    const office = loginRateKey(req({ email: "dana.reyes@acme.com" }, "10.0.0.7"));
    const home = loginRateKey(req({ email: "dana.reyes@acme.com" }, "203.0.113.9"));
    expect(office).toBe(home);
  });

  it("does not hand out a fresh budget for a change of case or padding", () => {
    const plain = loginRateKey(req({ email: "dana.reyes@acme.com" }));
    for (const variant of [
      "Dana.Reyes@Acme.com",
      "DANA.REYES@ACME.COM",
      "  dana.reyes@acme.com  ",
    ]) {
      expect(loginRateKey(req({ email: variant }))).toBe(plain);
    }
  });

  it("falls back to the address when no account is named", () => {
    // A malformed body the validator is about to reject: there is no account to
    // protect, but the attempt still has to be counted against something.
    for (const body of [undefined, null, {}, { email: "" }, { email: "   " }, { email: 42 }]) {
      expect(loginRateKey(req(body))).toBe("ip:10.0.0.7");
    }
  });

  it("masks an IPv6 fallback to a subnet, so one client cannot walk its own /64", () => {
    const one = loginRateKey(req({}, "2001:db8:1234:5678::1"));
    const two = loginRateKey(req({}, "2001:db8:1234:5679::9"));
    expect(one).toBe(two);
    expect(one).toBe("ip:2001:db8:1234:5600::/56");
  });

  it("never confuses an address bucket with an account bucket", () => {
    // Both are strings in one keyspace; the prefixes keep an address that looks
    // like an email (or the reverse) from sharing a budget with one.
    expect(loginRateKey(req({ email: "10.0.0.7" }))).not.toBe(
      loginRateKey(req({}, "10.0.0.7")),
    );
  });
});
