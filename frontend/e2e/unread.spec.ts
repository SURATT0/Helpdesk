import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

// Its own ticket (agent = demo Dana Reyes, requester = L. Osei) so the seeded
// backlog and the live message don't collide with the other chat specs.
const TICKET = 1025;
const REQUESTER_EMAIL = "l.osei@acme.com";
const API = "http://localhost:4000/api/v1";

test("new messages while scrolled up show an unread divider + jump-to-latest pill", async ({
  page,
  request,
}) => {
  // Seed a long backlog via the API (as the agent) so the thread is scrollable.
  const login = await request.post(`${API}/auth/login`, {
    data: { email: "dana.reyes@acme.com", password: "password123" },
  });
  const token: string = (await login.json()).data.accessToken;
  const authed = { Authorization: `Bearer ${token}` };
  for (let i = 0; i < 20; i++) {
    await request.post(`${API}/tickets/${TICKET}/comments`, {
      headers: authed,
      data: { body: `backlog message ${i}`, internal: false },
    });
  }

  // The requester opens the ticket (auto-scrolled to the latest) and scrolls up.
  await loginAs(page, REQUESTER_EMAIL);
  const streamRequested = page.waitForRequest((r) =>
    r.url().includes(`/tickets/${TICKET}/comments/stream`),
  );
  await page.goto(`/tickets/${TICKET}`);
  await page.getByPlaceholder(/Enter to send/).waitFor();
  await streamRequested;
  await page.waitForTimeout(3500); // SSE subscribed (generous under parallel load)
  await page.getByTestId("chat-scroll").evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(300);

  // The agent posts a new message while the requester is reading history.
  const marker = `live ping ${Date.now()}`;
  await request.post(`${API}/tickets/${TICKET}/comments`, {
    headers: authed,
    data: { body: marker, internal: false },
  });

  // An unread divider and a jump-to-latest pill appear (reader isn't yanked down).
  await expect(page.getByText("New messages")).toBeVisible();
  const pill = page.getByRole("button", { name: /new/ });
  await expect(pill).toBeVisible();

  // Clicking the pill jumps to the latest message and clears the unread state.
  await pill.click();
  await expect(page.getByText(marker)).toBeVisible();
  await expect(page.getByText("New messages")).toHaveCount(0);
});
