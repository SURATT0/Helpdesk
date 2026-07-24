import { test, expect } from "@playwright/test";
import { login, loginAs } from "./helpers";

test("permissions page shows your access + the role matrix", async ({ page }) => {
  await login(page); // demo agent (Dana Reyes)
  await page.goto("/permissions");

  await expect(page.getByText("Your access")).toBeVisible();
  await expect(page.getByText("Permissions by role")).toBeVisible();
  await expect(page.getByText("Ticket visibility")).toBeVisible();

  // A capability only admins hold is listed (matrix rendered).
  await expect(page.getByText("Manage users & roles")).toBeVisible();

  // The signed-in agent's column is flagged with a "You" marker.
  await expect(page.getByText("You", { exact: true })).toBeVisible();
});

test("the sidebar links to the permissions page", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Permissions" }).click();
  await expect(page).toHaveURL(/\/permissions/);
  await expect(page.getByText("Permissions by role")).toBeVisible();
});

test("a requester sees their own role flagged", async ({ page }) => {
  await loginAs(page, "marcus.chen@acme.com"); // requester
  await page.goto("/permissions");
  await expect(page.getByText("Your access")).toBeVisible();
  // Requester scope line is present.
  await expect(page.getByText("Only tickets you opened")).toBeVisible();
});
