/**
 * A random UUID, on every origin the app can legitimately be served from.
 *
 * `crypto.randomUUID()` exists only in a SECURE CONTEXT. Browsers count
 * `localhost` as one even over plain HTTP, so it is present all through
 * development and absent the moment the same build is opened at
 * `http://192.168.1.20:3000` — a phone on the office Wi-Fi, or anyone reaching
 * an internally-hosted desk by IP. Calling it there throws
 * `crypto.randomUUID is not a function`, and because the caller sits in an
 * effect that runs with the app shell, the whole page becomes React's
 * "Application error" rather than one broken feature.
 *
 * `crypto.getRandomValues()` has no such restriction, so the fallback is a
 * proper v4 UUID built from it — not `Math.random()`, which would quietly
 * weaken an identifier used as an idempotency key.
 */
export function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Version 4, variant 1 — the two fields RFC 4122 fixes; the rest stays random.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
