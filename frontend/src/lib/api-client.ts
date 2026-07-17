import { logger } from "./logger";
import { tokenStore } from "@/features/auth/token-store";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Json = Record<string, unknown>;

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Concurrent
 * callers share one in-flight request. On failure the token is cleared, which
 * the AuthProvider observes and treats as a logout.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        tokenStore.clear();
        return false;
      }
      const body = (await res.json().catch(() => null)) as Json | null;
      const token = (body?.data as { accessToken?: string } | undefined)
        ?.accessToken;
      if (typeof token !== "string") {
        tokenStore.clear();
        return false;
      }
      tokenStore.set(token);
      return true;
    } catch {
      tokenStore.clear();
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Thin fetch wrapper around the Deskly API. Attaches the bearer token, sends
 * cookies, and on a 401 tries a single silent refresh + retry. Parses JSON and
 * normalises errors to `ApiError`; callers validate the body with a zod schema.
 */
export async function apiRequest(
  path: string,
  init: RequestInit = {},
  opts: { skipRefresh?: boolean } = {},
): Promise<unknown> {
  const url = `${API_BASE_URL}${path}`;

  const send = (): Promise<Response> => {
    const token = tokenStore.get();
    // For FormData, let the browser set the multipart boundary Content-Type.
    const isFormData =
      typeof FormData !== "undefined" && init.body instanceof FormData;
    return fetch(url, {
      credentials: "include",
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && !opts.skipRefresh && (await refreshSession())) {
      res = await send();
    }
  } catch (cause) {
    logger.error(`network error: ${init.method ?? "GET"} ${url}`, cause);
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server");
  }

  const body = (await res.json().catch(() => null)) as Json | null;

  if (!res.ok) {
    const err = (body?.error ?? {}) as { code?: string; message?: string };
    const apiError = new ApiError(
      res.status,
      err.code ?? "UNKNOWN",
      err.message ?? res.statusText,
    );
    logger.warn(`${res.status} ${init.method ?? "GET"} ${path}`, apiError.code);
    throw apiError;
  }

  return body;
}
