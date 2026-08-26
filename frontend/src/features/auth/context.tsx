"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  bootstrapSession,
  login as apiLogin,
  logout as apiLogout,
} from "./api";
import { tokenStore } from "./token-store";
import type { AuthUser } from "./schemas";

type Status = "loading" | "authenticated" | "unauthenticated";
type State = { status: Status; user: AuthUser | null };

type AuthContextValue = State & {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  patchUser: (partial: Partial<AuthUser>) => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>({
    status: "loading",
    user: null,
  });
  const queryClient = useQueryClient();

  /**
   * Drop every cached query, because cached data belongs to the session that
   * fetched it and to no other.
   *
   * No query key names the signed-in user — `["tickets","list",filter]` is the
   * same key for everyone — so without this the next session reads the previous
   * one's rows out of the cache. Signing out of an agent account and into a
   * requester's in the same tab showed the agent's entire ticket list to someone
   * whose row scope allows only their own tickets, and `staleTime: 30s` meant it
   * was served for the first half-minute without so much as a refetch.
   *
   * Called on every identity change — sign in, sign out, and a session ending
   * because the refresh token stopped working — and always BEFORE the new state
   * is published, so no render can happen with the old cache under the new user.
   * Clearing is safe for in-flight work: react-query cancels the queries it
   * removes, and mounted components refetch under the new session.
   */
  const clearSessionCache = React.useCallback(() => {
    queryClient.clear();
  }, [queryClient]);

  // Bootstrap from the refresh cookie once on mount.
  React.useEffect(() => {
    let active = true;
    bootstrapSession().then((user) => {
      if (!active) return;
      setState(
        user
          ? { status: "authenticated", user }
          : { status: "unauthenticated", user: null },
      );
    });
    return () => {
      active = false;
    };
  }, []);

  // If the token gets cleared elsewhere (e.g. a failed silent refresh), fall
  // back to unauthenticated so the guard can redirect.
  React.useEffect(
    () =>
      tokenStore.subscribe(() => {
        if (!tokenStore.get()) {
          // Outside the updater: clearing is a side effect, and an updater can be
          // called more than once. Idempotent, so clearing when the session had
          // already ended costs nothing.
          clearSessionCache();
          setState((s) =>
            s.status === "authenticated"
              ? { status: "unauthenticated", user: null }
              : s,
          );
        }
      }),
    [clearSessionCache],
  );

  const login = React.useCallback(
    async (email: string, password: string) => {
      const user = await apiLogin(email, password);
      clearSessionCache();
      setState({ status: "authenticated", user });
    },
    [clearSessionCache],
  );

  const logout = React.useCallback(async () => {
    await apiLogout();
    clearSessionCache();
    setState({ status: "unauthenticated", user: null });
  }, [clearSessionCache]);

  const patchUser = React.useCallback((partial: Partial<AuthUser>) => {
    setState((s) => (s.user ? { ...s, user: { ...s.user, ...partial } } : s));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
