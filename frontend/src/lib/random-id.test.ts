import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

/**
 * The reason this helper exists is the non-secure origin, so that is the case
 * worth testing hardest: `crypto.randomUUID` is simply absent there, and the
 * app must keep working rather than throwing the page away.
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realUUID = globalThis.crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: realUUID,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

/** Take `crypto.randomUUID` away, the way a non-secure context does. */
function withoutRandomUUID() {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

describe("randomId", () => {
  it("uses the built-in when the context is secure", () => {
    const spy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-2222-4333-8444-555555555555");
    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(spy).toHaveBeenCalled();
  });

  it("still returns a v4 UUID when the built-in is missing", () => {
    withoutRandomUUID();
    expect(randomId()).toMatch(UUID_V4);
  });

  it("does not throw where it used to take the whole page down", () => {
    withoutRandomUUID();
    expect(() => randomId()).not.toThrow();
  });

  it("gives a different value each time — it is an idempotency key", () => {
    withoutRandomUUID();
    const seen = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(seen.size).toBe(200);
  });

  // Not Math.random(): this identifies a submission, and the server treats a
  // collision between two people as a replay of one person's ticket.
  it("draws from the crypto source rather than Math.random", () => {
    withoutRandomUUID();
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    randomId();
    expect(spy).toHaveBeenCalled();
  });
});
