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

/**
 * Deleting a ticket sits at the top tier — closing is the normal end of a ticket's
 * life. This covers who SEES the button; who the API lets through is covered by the
 * backend suite (an admin gets a 403 even if they call it directly), and that split
 * is deliberate: this spec must not delete rows out of the shared demo data.
 */
// One login per test: signing in again mid-test races the login page's redirect
// for an already-authenticated session, which is why these are two tests.
async function openFirstTicket(page: import("@playwright/test").Page) {
  await page.goto("/tickets");
  await page.getByText(/^#\d+$/).first().click();
  // Asserted by URL rather than by a status-dependent action button — the newest
  // tickets in the list are closed, so "Mark resolved" isn't offered on them.
  await expect(page).toHaveURL(/\/tickets\/\d+/);
}

test("delete ticket is hidden from an admin", async ({ page }) => {
  await loginAs(page, "dana.reyes@acme.com"); // admin — works cases, cannot delete
  await openFirstTicket(page);
  await expect(page.getByRole("button", { name: "Delete ticket" })).toBeHidden();
});

test("delete ticket is offered to a super admin, behind a confirm", async ({
  page,
}) => {
  await loginAs(page, "morgan.lee@acme.com"); // super_admin
  await openFirstTicket(page);

  const deleteButton = page.getByRole("button", { name: "Delete ticket" });
  await expect(deleteButton).toBeVisible();

  // The destructive step is never the first click: confirm, then cancel, and the
  // ticket is still there. Deleting for real is covered by the backend suite, so
  // this spec leaves the shared demo data intact.
  await deleteButton.click();
  await expect(page.getByText("Delete this ticket?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteButton).toBeVisible();
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
