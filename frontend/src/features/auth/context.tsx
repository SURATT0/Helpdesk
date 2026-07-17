"use client";

import * as React from "react";
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
          setState((s) =>
            s.status === "authenticated"
              ? { status: "unauthenticated", user: null }
              : s,
          );
        }
      }),
    [],
  );

  const login = React.useCallback(async (email: string, password: string) => {
    const user = await apiLogin(email, password);
    setState({ status: "authenticated", user });
  }, []);

  const logout = React.useCallback(async () => {
    await apiLogout();
    setState({ status: "unauthenticated", user: null });
  }, []);

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
