import { apiRequest, refreshSession } from "@/lib/api-client";
import { tokenStore } from "./token-store";
import { sessionEnvelope, userEnvelope, type AuthUser } from "./schemas";

/** Verify credentials, stash the access token, return the user. */
export async function login(
  email: string,
  password: string,
): Promise<AuthUser> {
  const body = await apiRequest(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    { skipRefresh: true },
  );
  const { user, accessToken } = sessionEnvelope.parse(body).data;
  tokenStore.set(accessToken);
  return user;
}

/** Revoke the session server-side and drop the in-memory token. */
export async function logout(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" }, { skipRefresh: true });
  } finally {
    tokenStore.clear();
  }
}

export async function fetchMe(): Promise<AuthUser> {
  const body = await apiRequest("/auth/me");
  return userEnvelope.parse(body).data;
}

/**
 * On load, exchange the httpOnly refresh cookie for a fresh access token, then
 * load the current user. Returns null if there is no valid session.
 */
export async function bootstrapSession(): Promise<AuthUser | null> {
  const ok = await refreshSession();
  if (!ok) return null;
  try {
    return await fetchMe();
  } catch {
    return null;
  }
}
