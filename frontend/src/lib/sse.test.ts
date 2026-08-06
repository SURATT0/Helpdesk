import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "./api-client";
import { runStream } from "./sse";

// Only the refresh call is faked: everything else about runStream is real, and the
// sleep is injected so the backoff can be asserted without waiting for it.
const refreshSession = vi.hoisted(() => vi.fn());
vi.mock("./api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api-client")>()),
  refreshSession: () => refreshSession(),
}));

const unauthorized = () => new ApiError(401, "STREAM_ERROR", "Notification stream failed");

/** Records what runStream was told to wait, so backoff is observable. */
function sleepSpy() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

beforeEach(() => {
  refreshSession.mockReset();
});

describe("runStream", () => {
  it("refreshes once on 401 and reconnects immediately with the new token", async () => {
    refreshSession.mockResolvedValue(true);
    const controller = new AbortController();
    const { waits, sleep } = sleepSpy();
    let attempts = 0;

    await runStream({
      signal: controller.signal,
      sleep,
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw unauthorized();
        // Second attempt carries the refreshed token: end the stream and stop.
        controller.abort();
      },
    });

    expect(attempts).toBe(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    // Immediately, not after a backoff: the token is already replaced.
    expect(waits).toEqual([]);
  });

  it("stops when the refresh fails — the session is genuinely over", async () => {
    refreshSession.mockResolvedValue(false);
    let attempts = 0;

    await runStream({
      signal: new AbortController().signal,
      sleep: async () => {},
      connect: async () => {
        attempts += 1;
        throw unauthorized();
      },
    });

    // One attempt, one refresh, then it gives up rather than looping on a dead
    // token — which is exactly what the 401 loop used to do forever.
    expect(attempts).toBe(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially on transport errors, capped", async () => {
    const controller = new AbortController();
    const { waits, sleep } = sleepSpy();
    let attempts = 0;

    await runStream({
      signal: controller.signal,
      sleep,
      baseDelayMs: 1_000,
      maxDelayMs: 4_000,
      connect: async () => {
        attempts += 1;
        if (attempts >= 6) controller.abort();
        throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server");
      },
    });

    expect(refreshSession).not.toHaveBeenCalled();
    expect(waits).toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);
  });

  it("treats a clean stream end as normal and resets the backoff", async () => {
    const controller = new AbortController();
    const { waits, sleep } = sleepSpy();
    let attempts = 0;

    await runStream({
      signal: controller.signal,
      sleep,
      baseDelayMs: 1_000,
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError(0, "NETWORK_ERROR", "boom");
        if (attempts === 3) controller.abort();
        // attempts 2 and 3 resolve: the server closed the stream.
      },
    });

    // 1s after the failure, then base delay again — the earlier failure is not
    // held against a stream that has since connected fine.
    expect(waits).toEqual([1_000, 1_000]);
  });

  it("does not reconnect after abort", async () => {
    const controller = new AbortController();
    let attempts = 0;

    await runStream({
      signal: controller.signal,
      sleep: async () => {},
      connect: async () => {
        attempts += 1;
        controller.abort();
        throw new ApiError(0, "NETWORK_ERROR", "closed mid-flight");
      },
    });

    expect(attempts).toBe(1);
  });
});
