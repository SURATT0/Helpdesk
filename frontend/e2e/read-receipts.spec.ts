import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// Dedicated ticket (agent = demo Dana Reyes, requester = S. Okafor) so another
// spec's read pointer can't flip this one's receipt.
const TICKET = 1039;
const REQUESTER_EMAIL = "s.okafor@acme.com";
const API = "http://localhost:4000/api/v1";

async function tokenFor(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password: "password123" },
  });
  return (await res.json()).data.accessToken as string;
}

test("an agent's message reads Sent, then flips to Read when the requester reads it", async ({
  page,
  request,
}) => {
  // The agent posts a message via the API (deterministic — avoids a flaky UI send).
  const agentToken = await tokenFor(request, "dana.reyes@acme.com");
  const marker = `receipt probe ${Date.now()}`;
  const posted = await request.post(`${API}/tickets/${TICKET}/comments`, {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { body: marker },
  });
  const commentId: number = (await posted.json()).data.id;

  // The agent opens the ticket. Nobody has read the message yet → "Sent".
  await login(page); // demo agent (Dana Reyes)
  await page.goto(`/tickets/${TICKET}`);
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByText(/Sent/)).toBeVisible();
  await page.waitForTimeout(1500); // ensure the agent's SSE stream is subscribed

  // The requester reads the ticket (via the API).
  const requesterToken = await tokenFor(request, REQUESTER_EMAIL);
  await request.post(`${API}/tickets/${TICKET}/comments/read`, {
    headers: { Authorization: `Bearer ${requesterToken}` },
    data: { lastReadId: commentId },
  });

  // The agent's receipt flips to "Read" over SSE, with no reload.
  await expect(page.getByText(/Read/)).toBeVisible();
  await expect(page.getByText(/Sent/)).toHaveCount(0);
});
