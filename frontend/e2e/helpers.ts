import { expect, type Page } from "@playwright/test";

export const DEMO = {
  email: "dana.reyes@acme.com",
  password: "password123",
};

/**
 * Sign in as any seeded user (all share the demo password) and wait for the
 * dashboard.
 *
 * The session is dropped first, so this works as a SWITCH of user and not only
 * as a first sign-in. `/login` sends an already-authenticated visitor straight
 * to the dashboard, and the access token lives in memory while the refresh
 * token is an httpOnly cookie — so a second call in the same test loaded the
 * form, revived the old session from that cookie, and redirected out from under
 * the fill. Playwright reported it as a 30s timeout on a field it had just
 * resolved, which reads like a hung page rather than a race with a redirect.
 * Clearing the cookie means the form stays put and the sign-in is the one the
 * test asked for.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string = DEMO.password,
) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  // Exact match: the redesigned login also has a "Sign in with demo account"
  // button, so a substring match would be ambiguous (strict-mode violation).
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Sign in as the demo agent and wait for the dashboard. */
export async function login(page: Page) {
  await loginAs(page, DEMO.email, DEMO.password);
}
