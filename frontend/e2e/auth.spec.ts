import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("unauthenticated visitor is redirected to login", async ({ page }) => {
  await page.goto("/tickets");
  await expect(page).toHaveURL(/\/login/);
});

test("can sign in and reach the dashboard shell", async ({ page }) => {
  await login(page);
  // Sidebar nav proves the authenticated shell rendered. Use links without a
  // count badge so the accessible name is unambiguous.
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Knowledge Base", exact: true }),
  ).toBeVisible();
});
