import { expect, type Page } from "@playwright/test";

export const DEMO = {
  email: "dana.reyes@acme.com",
  password: "password123",
};

/** Sign in as the demo agent and wait for the dashboard. */
export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
