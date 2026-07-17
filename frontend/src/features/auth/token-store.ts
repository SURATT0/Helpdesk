/**
 * In-memory access-token holder. The access token is deliberately NOT persisted
 * to localStorage/cookies (per the auth spec) — it lives only here for the tab's
 * lifetime and is re-obtained via the httpOnly refresh cookie on reload. Kept
 * outside React so the fetch client can read it synchronously.
 */
type Listener = () => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: () => accessToken,
  set: (token: string) => {
    accessToken = token;
    listeners.forEach((l) => l());
  },
  clear: () => {
    accessToken = null;
    listeners.forEach((l) => l());
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
