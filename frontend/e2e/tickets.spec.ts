import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("search filters the ticket list to an empty state for no matches", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  // At least one ticket row is visible for the demo agent.
  await expect(page.getByText(/^#\d+$/).first()).toBeVisible();

  const search = page.getByPlaceholder("Search subject, #id, requester…");
  await search.fill("zzz-no-such-ticket");
  await expect(page.getByText("No tickets match your filters")).toBeVisible();

  await search.fill("");
  await expect(page.getByText(/^#\d+$/).first()).toBeVisible();
});

test("List/Board toggle switches to the kanban view", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  // Board renders a column header for each status.
  await expect(page.getByText("In Progress").first()).toBeVisible();
});

// Raising a ticket belongs on the tickets page. The button is the only entry
// point to the create-ticket modal, so this also pins where a ticket can be
// raised from at all — not just where the button is drawn.
test("New ticket lives on the tickets page only", async ({ page }) => {
  await login(page);
  const button = page.getByRole("button", { name: "New ticket" });

  await page.goto("/tickets");
  await expect(button).toBeVisible();

  for (const path of ["/dashboard", "/permissions", "/history"]) {
    await page.goto(path);
    await expect(button).toBeHidden();
  }
});

test("create-ticket modal shows live KB deflection from the subject", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page
    .getByPlaceholder("Short summary of the issue")
    .fill("vpn keeps dropping");
  await expect(
    page.getByText("VPN 4.2 keepalive bug — rollback steps"),
  ).toBeVisible();
});
