import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// An agent's chat message must appear immediately (optimistic) and then survive
// the server round-trip + the SSE echo of its own message as exactly ONE entry
// (no duplicate). A strict-mode getByText would also fail on a duplicate.
test("chat message posts optimistically and stays a single entry after the SSE echo", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets/1042");

  const box = page.getByPlaceholder(/Enter to send/);
  await box.waitFor();

  const message = `optimistic probe ${Date.now()}`;
  await box.fill(message);
  await box.press("Enter");

  // Appears in the thread right away (before the network settles).
  await expect(page.getByText(message)).toBeVisible();
  // The input is cleared immediately (optimistic UX).
  await expect(box).toHaveValue("");

  // After the server responds and the SSE stream echoes our own message back,
  // it must remain exactly one entry (optimistic entry swapped, echo deduped).
  await page.waitForTimeout(2500);
  await expect(page.getByText(message)).toHaveCount(1);
});
