import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * An administrator creates an account, and the person it was created for turns
 * the handed-over password into one of their own.
 *
 * The whole round trip, through the screens rather than the API, because the
 * part worth guarding is the part the API cannot express: a person who signs in
 * with a borrowed password must land on the form that replaces it and nowhere
 * else, however they navigate. The server refuses those routes anyway — this
 * checks the app does not strand them in front of a dashboard of error states
 * while finding that out.
 */

const PLATFORM = "sam.rivera@acme.com"; // super_admin with no customer
const ACME_ADMIN = "dana.reyes@acme.com"; // admin — may not create accounts

const HANDED_OVER = "handed-over-for-now";
const CHOSEN = "one-only-i-know-now";

/** A fresh address per test, so a rerun does not hit the duplicate branch. */
const freshEmail = () => `e2e-created-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

async function createAccount(page: Page, email: string) {
  await page.goto("/users");
  await page.getByRole("button", { name: "Add person" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Full name").fill("E2E Created");
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Temporary password").fill(HANDED_OVER);
  await dialog.getByLabel("Customer").selectOption({ label: "Acme Corp" });
  await dialog.getByRole("button", { name: "Create account" }).click();

  await expect(dialog).toBeHidden();
  // The directory is the confirmation — the row is what the administrator needs
  // to see, not a toast that disappears.
  await expect(page.getByText(email)).toBeVisible();
}

test("an administrator creates an account and the person makes it their own", async ({
  page,
}) => {
  const email = freshEmail();

  await loginAs(page, PLATFORM);
  await createAccount(page, email);

  // --- the handed-over password gets them in, and no further -----------------
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(HANDED_OVER);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Sent to the form rather than to the dashboard they asked for.
  await expect(page).toHaveURL(/\/change-password/);
  await expect(
    page.getByText("The password you signed in with was set by an administrator", {
      exact: false,
    }),
  ).toBeVisible();

  // And typing a route by hand does not get round it. This is the assertion the
  // guard exists for: the redirect lives in RequireAuth, which wraps every page
  // in the authenticated shell.
  await page.goto("/tickets");
  await expect(page).toHaveURL(/\/change-password/);

  // --- replacing it opens the desk ------------------------------------------
  await page.getByLabel("Current password").fill(HANDED_OVER);
  await page.getByLabel("New password", { exact: true }).fill(CHOSEN);
  await page.getByLabel("Confirm password").fill(CHOSEN);
  await page.getByRole("button", { name: "Save new password" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  // Signed in, not bounced to the sign-in form — the change hands back a session.
  await page.goto("/tickets");
  await expect(page).toHaveURL(/\/tickets/);

  // --- and the borrowed password is dead ------------------------------------
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(HANDED_OVER);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("the new password must differ from the one handed over", async ({ page }) => {
  const email = freshEmail();
  await loginAs(page, PLATFORM);
  await createAccount(page, email);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(HANDED_OVER);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/change-password/);

  await page.getByLabel("Current password").fill(HANDED_OVER);
  await page.getByLabel("New password", { exact: true }).fill(HANDED_OVER);
  await page.getByLabel("Confirm password").fill(HANDED_OVER);

  // Said before the round trip, and the button refuses — otherwise the flag
  // would clear while the shared secret stayed in place.
  await expect(
    page.getByText("must be different from your current one", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save new password" }),
  ).toBeDisabled();
});

test("an admin is not offered the control at all", async ({ page }) => {
  // Creating an account chooses somebody's tenant, which is platform-wide only.
  // The server refuses it; this is the half that keeps a refused button off the
  // screen in the first place.
  await loginAs(page, ACME_ADMIN);
  await page.goto("/users");
  await expect(page.getByRole("button", { name: "Add person" })).toHaveCount(0);
});

test("anybody can change their own password from Settings", async ({ page }) => {
  // The desk had no route for this before — only the emailed reset link, which
  // is no use on a deployment whose mail cannot leave.
  await loginAs(page, ACME_ADMIN);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/change-password/);
  // Not the forced arrival: this one may turn back.
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});
