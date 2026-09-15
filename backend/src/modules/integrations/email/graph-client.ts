import { env } from "../../../config/env";

/**
 * The one way this codebase talks to Microsoft Graph.
 *
 * Both directions go through here — the inbox reader and the outbound sender —
 * so there is one token cache and one place that knows what a Graph failure
 * looks like. Two caches would mean two round trips to Microsoft per sweep and
 * two chances for one of them to hold a token the other has already seen
 * refused.
 *
 * App-only OAuth2 (client credentials): no user signs in, the registered
 * application holds the grant. That is what makes it usable from a background
 * sweep, and it is also why every call has to name the mailbox it means — an
 * app-only token belongs to nobody in particular.
 */

type TokenResponse = { access_token: string; expires_in: number };

/** All four values present. A half-filled config reads as off, not as broken. */
export function graphConfigured(): boolean {
  const { tenantId, clientId, clientSecret, mailbox } = env.integrations.graph;
  return Boolean(tenantId && clientId && clientSecret && mailbox);
}

let cached: { value: string; expiresAt: number } | null = null;

/** Exposed for tests, which must not inherit a token from the case before. */
export function resetGraphToken(): void {
  cached = null;
}

export async function graphToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const { tenantId, clientId, clientSecret } = env.integrations.graph;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        // `.default` asks for whatever application permissions the tenant has
        // already consented to. A client-credentials grant cannot ask for more
        // — there is no user present to consent to anything.
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!res.ok) {
    // Microsoft's own reason — wrong secret, unconsented permission, unknown
    // tenant — and none of it is secret. Without it every misconfiguration
    // reads as the same opaque failure, and the AADSTS code is the one thing
    // that says which.
    throw new Error(
      `Graph token request failed (${res.status}): ${await safeText(res)}`,
    );
  }
  const body = (await res.json()) as TokenResponse;
  cached = {
    value: body.access_token,
    // A minute off the expiry, against the clock skew between here and
    // Microsoft: a token that expires mid-flight comes back as a 401 nothing
    // can tell apart from a revoked grant.
    expiresAt: now + Math.max(body.expires_in - 60, 30) * 1000,
  };
  return cached.value;
}

export async function graphFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await graphToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
}

/** Never let reading an error body throw a second error over the first. */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}
