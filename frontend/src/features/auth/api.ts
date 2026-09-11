import { apiRequest, refreshSession } from "@/lib/api-client";
import { tokenStore } from "./token-store";
import {
  sessionEnvelope,
  userEnvelope,
  verifyEmailEnvelope,
  type AuthUser,
  type UserStatus,
} from "./schemas";

/**
 * The four self-service calls, all of them made by somebody who is NOT signed
 * in.
 *
 * Every one passes `skipRefresh` — there is no session to refresh, and without
 * it a 4xx from any of them would fire a pointless refresh attempt whose failure
 * clears a token store that was already empty.
 *
 * Three of them return nothing at all, and the page writes the sentence. They
 * used to hand back the server's own English prose, which then sat in the middle
 * of a Thai form: the API is not told which language the reader has and has no
 * business composing UI copy for one.
 *
 * What that must NOT turn into is a page that branches on the outcome.
 * Registration and the reset request are answered IDENTICALLY whatever the
 * address turns out to be — that uniformity is what stops the public forms
 * doubling as a way to ask who has an account here. Each of these calls has
 * exactly one success, so each page has exactly one sentence and nothing to look
 * up. The day someone wants a friendlier "this email is already taken", the
 * property is gone, and the refusal belongs here rather than in the copy.
 */

/** Submit a registration. Says nothing about whether the address was free. */
export async function register(input: {
  email: string;
  name: string;
  password: string;
  confirmPassword: string;
  lang: "en" | "th";
}): Promise<void> {
  await apiRequest(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
    { skipRefresh: true },
  );
}

/** Redeem an email-confirmation link. Returns the account's status after it. */
export async function verifyEmail(token: string): Promise<UserStatus> {
  const body = await apiRequest(
    "/auth/verify-email",
    { method: "POST", body: JSON.stringify({ token }) },
    { skipRefresh: true },
  );
  return verifyEmailEnvelope.parse(body).data.status;
}

/** Ask for a reset link. Answers the same whether or not one was sent. */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest(
    "/auth/forgot-password",
    { method: "POST", body: JSON.stringify({ email }) },
    { skipRefresh: true },
  );
}

/**
 * Redeem a reset link and set a new password.
 *
 * Returns nothing, and in particular not a session: the reset just signed this
 * account out everywhere, and taking a session back here would undo the half of
 * that guarantee that matters. The page sends them to sign in.
 */
export async function resetPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  await apiRequest(
    "/auth/reset-password",
    { method: "POST", body: JSON.stringify(input) },
    { skipRefresh: true },
  );
}

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
