import { test, expect } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The delete control on the Projects page: who has it in their document at all,
 * and what stands between having it and losing a project.
 *
 * The absence assertions use `toHaveCount(0)`, never `toBeHidden()` — an element
 * that is present and merely styled away is still reachable, and "the button is
 * not rendered" is the thing being tested.
 */

// `login()` signs in as Dana Reyes — the demo agent, role `admin`.
const SUPERUSER = "morgan.lee@acme.com"; // super_admin, Acme
const REQUESTER = "marcus.chen@acme.com";

/** Every seeded project has members, so this is the blocked case. */
const SEEDED = "Acme Facilities";

test("an agent's Projects page has no delete control anywhere in it", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projects");

  // The page rendered — an admin may read the routing table.
  await expect(page.getByText(SEEDED)).toBeVisible();

  await expect(page.locator("[data-delete-project]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Delete project/ })).toHaveCount(0);
  // No disabled stand-in and no explanation of what is missing.
  await expect(page.getByText(/don't have permission/i)).toHaveCount(0);
});

test("the row keeps its shape without the actions column", async ({ page }) => {
  // The grid drops the column rather than leaving it empty, so nothing on an
  // agent's row is pushed left of where a super admin sees it.
  await login(page);
  await page.goto("/projects");
  const asAgent = await page
    .getByText(SEEDED)
    .locator("xpath=ancestor::div[contains(@class,'grid')][1]")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);

  // Four tracks for the agent; the super admin gets a fifth.
  expect(asAgent.split(" ").length).toBe(4);
});

test("a requester never reaches the page at all", async ({ page }) => {
  await loginAs(page, REQUESTER);
  await page.goto("/projects");
  await expect(page.locator("[data-delete-project]")).toHaveCount(0);
  await expect(page.getByText(SEEDED)).toHaveCount(0);
});

test("a super admin gets the control, and the dialog's two brakes", async ({
  page,
}) => {
  await loginAs(page, SUPERUSER);
  await page.goto("/projects");

  const rows = page.locator("[data-delete-project]");
  await expect(rows.first()).toBeVisible();

  // A seeded project has members, so this one is refused outright.
  await page.getByRole("button", { name: `Delete project ${SEEDED}` }).click();
  await expect(page.getByText("This action cannot be undone")).toBeVisible();

  // Scoped to the dialog: Next's own route announcer is also role="alert".
  const dialog = page.getByRole("dialog", { name: "Delete project" });
  await expect(dialog.getByRole("alert")).toContainText("Cannot delete");
  await expect(dialog.getByRole("alert")).toContainText(
    "route through this project",
  );
  // Blocked means blocked: no name field to type into, no way past it.
  await expect(page.getByLabel("Type the project name to confirm")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete project", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("link", { name: "View members" })).toBeVisible();
});

test("an empty project can be deleted, but only after the name is typed", async ({
  page,
}) => {
  await loginAs(page, SUPERUSER);
  await page.goto("/projects");

  // A project of this test's own, with nobody routing through it.
  const name = `E2E Scratch ${Date.now()}`;
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder("Project name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(name)).toBeVisible();

  await page.getByRole("button", { name: `Delete project ${name}` }).click();
  const confirm = page.getByRole("button", { name: "Delete project", exact: true });

  // Not armed until the name matches exactly.
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type the project name to confirm").fill("wrong name");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type the project name to confirm").fill(name);
  await expect(confirm).toBeEnabled();

  await confirm.click();
  // Gone from the list, and the dialog closed itself.
  await expect(page.getByText(name)).toHaveCount(0);
  await expect(page.getByText("This action cannot be undone")).toHaveCount(0);
});
