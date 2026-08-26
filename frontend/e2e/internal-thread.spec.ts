import { test, expect } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * A ticket the desk raised for itself has no requester on the other end, so the
 * composer offers the internal note alone — no chat, no email reply. The API
 * enforces the same rule (a comment is stored as a note, a reply is refused);
 * this pins the surface the agent actually sees.
 */

test("a ticket an admin raises for themselves has notes only", async ({
  page,
}) => {
  await loginAs(page, DEMO.email); // Dana Reyes, admin — requester and desk both
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();

  await page.getByLabel("Subject").fill("Rebuild the imaging share index");
  await page
    .getByLabel("Description")
    .fill("Housekeeping the desk raised for itself; no requester involved.");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create ticket" }).click();

  // Creating navigates to the new ticket.
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  await expect(
    page.getByRole("button", { name: "Internal note" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reply" })).toHaveCount(0);
  // The note box is live without a click, and says why it is the only one.
  await expect(
    page.getByPlaceholder(/Add an internal note/),
  ).toBeVisible();
  await expect(page.getByText(/Raised by the desk/)).toBeVisible();
});

test("a requester's ticket keeps chat and the email reply", async ({ page }) => {
  await loginAs(page, DEMO.email);
  await page.goto("/tickets");

  // 1042 is seeded for Marcus Chen, a requester.
  await page.goto("/tickets/1042");
  await expect(page.getByRole("button", { name: "Chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Internal note" }),
  ).toBeVisible();
  await expect(page.getByText(/Raised by the desk/)).toHaveCount(0);
});
