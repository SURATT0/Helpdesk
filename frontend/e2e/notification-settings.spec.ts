import { test, expect, type Page } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The panel itself. Scoped rather than reached through the page, because its
 * Save button reads exactly like the account section's — "Save changes" alone
 * matches both and trips strict mode.
 */
const panel = (page: Page) => page.locator("[data-notification-settings]");

/**
 * The notification policy panel on the Settings page.
 *
 * Two things worth holding still: who is shown it, and that saving it actually
 * changes what the desk does — the SLA window is one value driving both the
 * emails and the amber on the ticket list, so a save has to move the list too.
 *
 * The agent's assertions count nodes rather than checking visibility: a panel
 * that is present but styled away is still readable in dev tools, which is not
 * "hidden" in any sense that matters for configuration.
 */

// `login()` signs in as Dana Reyes — the demo agent (role `admin`).
const TENANT_ADMIN = "morgan.lee@acme.com"; // super_admin of Acme

test("an agent's Settings page contains no notification policy at all", async ({
  page,
}) => {
  await login(page); // Dana Reyes, admin
  await page.goto("/settings");
  await expect(page.getByText("Preferences")).toBeVisible(); // page did render

  await expect(page.getByText("Send an email when…")).toHaveCount(0);
  await expect(page.getByLabel("Warn before SLA (minutes)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
});

test("a super admin gets the panel, on the system defaults to begin with", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN);
  await page.goto("/settings");

  await expect(page.getByText("Send an email when…")).toBeVisible();
  // An unconfigured desk says so, rather than looking like somebody chose this.
  await expect(page.getByText(/Following the system defaults/)).toBeVisible();
  await expect(page.getByLabel("Warn before SLA (minutes)")).toHaveValue("240");
  // Nothing to reset until something is stored.
  await expect(page.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
});

test("every event starts switched on, and can be switched off", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN);
  await page.goto("/settings");

  const slaWarning = page.getByRole("checkbox", {
    name: "A ticket approaches its SLA",
  });
  await expect(slaWarning).toBeChecked();
  await slaWarning.uncheck();
  await expect(slaWarning).not.toBeChecked();
});

test("saving stores the policy and offers a way back to the defaults", async ({
  page,
}) => {
  await loginAs(page, TENANT_ADMIN);
  await page.goto("/settings");

  await page.getByLabel("Warn before SLA (minutes)").fill("90");
  await page.getByLabel("Emails per ticket").fill("5");
  await panel(page).getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText(/This customer's own policy/)).toBeVisible();
  const reset = page.getByRole("button", { name: "Reset to defaults" });
  await expect(reset).toBeVisible();

  // And back again — the row is dropped rather than rewritten, so the desk
  // follows the defaults as they change instead of freezing a copy.
  await reset.click();
  await expect(page.getByText(/Following the system defaults/)).toBeVisible();
  await expect(page.getByLabel("Warn before SLA (minutes)")).toHaveValue("240");
});

test("a value outside its bounds cannot be saved", async ({ page }) => {
  await loginAs(page, TENANT_ADMIN);
  await page.goto("/settings");

  await page.getByLabel("Emails per ticket").fill("0");
  await expect(
    panel(page).getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
});
