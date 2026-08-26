/**
 * The mutation network mode is load-bearing, so it gets a test rather than a
 * comment alone.
 *
 * React Query's default (`networkMode: "online"`) *pauses* a mutation fired
 * while the browser is offline: the promise never settles, `status` stays
 * `pending` and `isError` stays false. Every write in the app is awaited and
 * every failure branch keys on `isError`, so that default turns "offline" into
 * "hangs with no error" — the create dialog stuck on "Creating…". Nothing
 * persists the mutation cache, so a paused write is a promise the app cannot
 * keep anyway.
 *
 * These assert the behaviour, not the config value, so they would also catch a
 * React Query upgrade that changed what `"always"` means.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MutationObserver,
  QueryClient,
  onlineManager,
} from "@tanstack/react-query";
import { QUERY_CLIENT_OPTIONS } from "./query-client";

afterEach(() => onlineManager.setOnline(true));

/** Fire a failing mutation while offline and report how it settled. */
async function mutateOffline(client: QueryClient) {
  onlineManager.setOnline(false);
  const observer = new MutationObserver(client, {
    mutationFn: async () => {
      throw new Error("network down");
    },
  });
  let settled = false;
  void observer.mutate().catch(() => {
    settled = true;
  });
  // One macrotask is enough: "always" rejects immediately, "online" never does.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { settled, result: observer.getCurrentResult() };
}

describe("QUERY_CLIENT_OPTIONS", () => {
  it("fails an offline mutation instead of pausing it forever", async () => {
    const { settled, result } = await mutateOffline(
      new QueryClient(QUERY_CLIENT_OPTIONS),
    );

    expect(settled).toBe(true);
    expect(result.isPaused).toBe(false);
    // The dialogs render their error from these two.
    expect(result.isError).toBe(true);
    expect(result.isPending).toBe(false);
  });

  it("documents the default this overrides — a mutation that never settles", async () => {
    const { settled, result } = await mutateOffline(
      new QueryClient({
        defaultOptions: { queries: QUERY_CLIENT_OPTIONS.defaultOptions.queries },
      }),
    );

    expect(settled).toBe(false);
    expect(result.isPaused).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.isPending).toBe(true);
  });
});
