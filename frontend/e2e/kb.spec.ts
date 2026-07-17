import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("browse the knowledge base and open an article", async ({ page }) => {
  await login(page);
  await page.goto("/kb");

  const card = page.getByText("Reset your corporate email password");
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(/\/kb\/KB-017/);
  await expect(
    page.getByRole("heading", { name: "Reset your corporate email password" }),
  ).toBeVisible();
});

test("filter KB by category", async ({ page }) => {
  await login(page);
  await page.goto("/kb");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expect(
    page.getByText("VPN 4.2 keepalive bug — rollback steps"),
  ).toBeVisible();
  // An Email-category article should be filtered out.
  await expect(
    page.getByText("Reset your corporate email password"),
  ).toHaveCount(0);
});
