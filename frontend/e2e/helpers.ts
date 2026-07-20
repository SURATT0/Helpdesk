import { expect, type Page } from "@playwright/test";

export const DEMO = {
  email: "dana.reyes@acme.com",
  password: "password123",
};

/** Sign in as any seeded user (all share the demo password) and wait for the dashboard. */
export async function loginAs(
  page: Page,
  email: string,
  password: string = DEMO.password,
) {
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
