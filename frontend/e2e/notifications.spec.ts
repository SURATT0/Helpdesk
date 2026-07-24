import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

const API = "http://localhost:4000/api/v1";
const REQUESTER_EMAIL = "marcus.chen@acme.com"; // requester of ticket 1042

async function tokenFor(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password: "password123" },
  });
  return (await res.json()).data.accessToken as string;
}

test("the notification bell updates live over SSE (no poll wait)", async ({
  page,
  request,
}) => {
  // Start from a clean slate: mark the requester's notifications all read.
  const requesterToken = await tokenFor(request, REQUESTER_EMAIL);
  await request.post(`${API}/notifications/read-all`, {
    headers: { Authorization: `Bearer ${requesterToken}` },
  });

  await loginAs(page, REQUESTER_EMAIL); // lands on the dashboard (bell in the shell)
  const bell = page.getByRole("button", { name: "Notifications" });
  await expect(bell).toBeVisible();
  await expect(bell.getByText("1")).toHaveCount(0); // no unread yet
  await page.waitForTimeout(2000); // notification SSE stream subscribed

  // An agent comments on the requester's ticket → a notification for them.
  const agentToken = await tokenFor(request, "dana.reyes@acme.com");
  await request.post(`${API}/tickets/1042/comments`, {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: { body: `bell probe ${Date.now()}` },
  });

  // The unread badge appears live — driven by the stream, not the slow poll.
  await expect(bell.getByText("1")).toBeVisible();
});
