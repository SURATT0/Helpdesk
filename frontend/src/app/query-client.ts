import type { QueryClientConfig } from "@tanstack/react-query";

/**
 * Defaults for the app's single QueryClient.
 *
 * Its own module rather than an inline literal in `providers.tsx` so the
 * behaviour can be asserted without rendering the provider tree — see
 * `providers.test.ts`.
 */
export const QUERY_CLIENT_OPTIONS = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      /**
       * Attempt the request even when the browser reports itself offline, so a
       * write FAILS instead of hanging.
       *
       * React Query's default (`"online"`) *pauses* a mutation fired while
       * offline: the promise never settles, `isPending` stays true and
       * `isError` stays false — so an awaited `mutateAsync` hangs forever and
       * every "something went wrong" branch is unreachable. The create dialog
       * sat on "Creating…" with no error and no way back.
       *
       * Pausing would only be honest if the queue outlived the tab, and nothing
       * persists the mutation cache here — a reload drops it. So a paused write
       * is a promise the app cannot keep: better to fail now, show the error,
       * and let the person retry. Worse still, the paused mutation resumed on
       * reconnect and created the ticket after the dialog had been closed.
       *
       * Queries are deliberately left on the default: a read that resumes when
       * the connection returns is a different bargain from a write that fires
       * twice.
       */
      networkMode: "always",
    },
  },
} as const satisfies QueryClientConfig;
