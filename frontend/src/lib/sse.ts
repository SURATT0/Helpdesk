import { ApiError, refreshSession } from "./api-client";
import { logger } from "./logger";

/**
 * Keep an SSE subscription alive across drops, expiries and outages.
 *
 * The streams use fetch rather than EventSource so the in-memory access token can
 * ride as a header — which also means they miss the refresh-on-401 retry that
 * `apiRequest` does for ordinary calls. Without that, a stream whose token had
 * expired reconnected with the SAME dead token every couple of seconds, forever:
 * a 401 loop that never recovered and never gave up.
 *
 * The policy here:
 *   - 401 → refresh once, then reconnect immediately with the new token. If the
 *     refresh fails the session is genuinely over, so stop; `refreshSession`
 *     clears the token and the AuthProvider treats that as a logout.
 *   - any other failure → reconnect with exponential backoff, capped, so a server
 *     restart or a flaky network costs a handful of requests rather than one every
 *     two seconds indefinitely.
 *   - clean end (the server closed the stream) → reconnect promptly; this is the
 *     normal case and not a failure.
 *
 * `connect` must throw on a failed connection and resolve when the stream ends.
 */
export async function runStream({
  connect,
  signal,
  baseDelayMs = 2_000,
  maxDelayMs = 30_000,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  label = "stream",
}: {
  connect: (signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  label?: string;
}): Promise<void> {
  let failures = 0;

  while (!signal.aborted) {
    try {
      await connect(signal);
      // Server closed the stream: expected, so treat the next attempt as the
      // first rather than as a continued failure.
      failures = 0;
    } catch (err) {
      if (signal.aborted) return;

      if (err instanceof ApiError && err.status === 401) {
        // Refresh is single-flighted in api-client, so several streams hitting
        // 401 together share one call rather than racing each other.
        const refreshed = await refreshSession();
        if (!refreshed) {
          logger.warn(`${label}: session over, not reconnecting`);
          return;
        }
        // New token in hand — retry at once, and don't count this as a failure.
        failures = 0;
        continue;
      }

      failures += 1;
    }

    if (signal.aborted) return;
    const delay = Math.min(baseDelayMs * 2 ** Math.max(0, failures - 1), maxDelayMs);
    await sleep(delay);
  }
}
