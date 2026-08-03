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

/**
 * Routing projects are management structure, so they sit at manager level and up.
 * The nav entry mirrors the server's project:read grant, and a direct visit gets a
 * forbidden panel rather than an error — the API is still the real gate.
 */
test("routing projects are hidden from an agent, in the nav and on the page", async ({
  page,
}) => {
  await login(page); // Dana Reyes — agent
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Projects" })).toBeHidden();

  await page.goto("/projects");
  await expect(
    page.getByText("You don't have access to routing projects"),
  ).toBeVisible();
});

test("a manager reaches routing projects from the nav", async ({ page }) => {
  await loginAs(page, "morgan.lee@acme.com"); // manager, Acme
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects/);
  // Their own customer's projects, and the page is usable rather than forbidden.
  await expect(page.getByText("Acme Migration")).toBeVisible();
  await expect(
    page.getByText("You don't have access to routing projects"),
  ).toBeHidden();
});

test("a user sees their own role flagged", async ({ page }) => {
  await loginAs(page, "marcus.chen@acme.com"); // user — the bottom tier
  await page.goto("/permissions");
  await expect(page.getByText("Your access")).toBeVisible();
  // The user scope line is present.
  await expect(page.getByText("Only tickets you opened")).toBeVisible();
});

test("the matrix names the three tiers and holds role apart from reach", async ({
  page,
}) => {
  await login(page); // admin
  await page.goto("/permissions");

  for (const label of ["User", "Admin", "Super Admin"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  // The top row's reach depends on more than the role, so the copy has to say so —
  // a super admin who belongs to a customer stays inside it.
  await expect(
    page.getByText(/or every customer, if you belong to none/),
  ).toBeVisible();
});
