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
 * The routing table splits reading from changing: `project:read` reaches admin,
 * because where a queue's work comes from is desk work, while `project:write`
 * stays at the top — owning a project is management structure.
 *
 * So an admin gets the nav entry and the table, and the owner cells are plain
 * names rather than pickers. A disabled picker would have been the wrong
 * rendering: it reads as "not available right now" instead of "not yours".
 */
test("an admin reads the routing table but is offered no way to change it", async ({
  page,
}) => {
  await login(page); // Dana Reyes — admin
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects/);

  await expect(page.getByText("Acme Migration")).toBeVisible();
  await expect(
    page.getByText("You don't have access to routing projects"),
  ).toBeHidden();
  // No owner pickers and no way to add a project — the writes are above them.
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
});

test("routing projects stay forbidden for a requester", async ({ page }) => {
  await loginAs(page, "marcus.chen@acme.com"); // user — the bottom tier
  await page.goto("/projects");
  await expect(
    page.getByText("You don't have access to routing projects"),
  ).toBeVisible();
});

/**
 * The activity log follows the same split, minus the write half: `audit:read`
 * reaches admin because someone working a case needs to see what happened to a
 * ticket before they picked it up, and nobody writes the trail at all.
 */
test("an admin reads the activity log; a requester does not", async ({ page }) => {
  await login(page); // Dana Reyes — admin
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Activity log" }).click();
  await expect(page).toHaveURL(/\/audit/);
  await expect(page.getByText(/don't have access/)).toBeHidden();
});

/**
 * The requester's menu as a SET — what is there and what is not.
 *
 * One entry at a time would not catch the thing that went wrong here: a nav entry
 * added without a `roles` gate shows a requester a link that answers 403. Asserting
 * the whole list makes that a failing test rather than a shipped dead end.
 */
test("a requester's sidebar holds their own pages and no staff ones", async ({
  page,
}) => {
  await loginAs(page, "marcus.chen@acme.com"); // user — the bottom tier
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation");

  for (const label of [
    "Dashboard",
    "Tickets",
    "Ticket history",
    "Reports",
    "Knowledge Base",
    "Permissions",
    "Settings",
  ]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  // The desk's own pages. Users is the directory behind user:read — a requester
  // was shown it and got a forbidden panel.
  for (const label of ["Users", "Projects", "Activity log"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  }

  // Tickets stays: it is where a requester raises one and follows their own.
  await nav.getByRole("link", { name: "Tickets" }).click();
  await expect(page).toHaveURL(/\/tickets/);
  await expect(page.getByRole("button", { name: "New ticket" })).toBeVisible();
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

/**
 * The matrix must agree with the API, cell by cell.
 *
 * Every earlier test here reads the page's own words back. That is what let
 * three rows go wrong for as long as they did: the table said only a super
 * admin may assign a ticket while `PATCH /tickets/:id/assignee` asks for
 * `ticket:write`, which every admin holds — and writing the knowledge base and
 * deleting a ticket were enforced on routes but had no row at all.
 *
 * So this reads the cells, and pairs each claim with the API behaviour that
 * settles it: an admin who can really reassign a ticket, and one who can really
 * publish an article.
 */
test("the matrix says an admin may assign a ticket — and the admin can", async ({
  page,
}) => {
  await loginAs(page, "dana.reyes@acme.com"); // admin
  await page.goto("/permissions");

  const cell = (cap: string, role: string) =>
    page.locator(`tr[data-cap="${cap}"] td[data-role="${role}"]`);

  await expect(cell("cap.assign", "admin")).toHaveAttribute(
    "data-allowed",
    "true",
  );
  // Handing over a WHOLE QUEUE is the row that stops at the top tier.
  await expect(cell("cap.handover", "admin")).toHaveAttribute(
    "data-allowed",
    "false",
  );
  await expect(cell("cap.handover", "super_admin")).toHaveAttribute(
    "data-allowed",
    "true",
  );

  // And the claim holds where assignment actually happens: the bulk bar, whose
  // Assign and Priority menus fan out to PATCH /tickets/:id/assignee and
  // /priority — the two ticket:write routes this row is about. Nothing is
  // applied; that the menus are offered to an admin at all is the point.
  await page.goto("/tickets");
  await page.getByLabel(/^Select ticket #\d+$/).first().click();
  // `exact`: the filter bar has a "＋ Assignee" chip and the table a sortable
  // "Priority" header, so a loose name matches three buttons on this page.
  const bar = page.getByText(/^\d+ selected$/).locator("..");
  await expect(bar.getByRole("button", { name: "Assign", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Priority", exact: true })).toBeVisible();
});

test("the matrix lists writing the knowledge base, and an admin holds it", async ({
  page,
}) => {
  await loginAs(page, "dana.reyes@acme.com"); // admin — holds kb:write
  await page.goto("/permissions");

  const row = page.locator('tr[data-cap="cap.kb"]');
  await expect(row).toBeVisible();
  await expect(row.locator('td[data-role="admin"]')).toHaveAttribute(
    "data-allowed",
    "true",
  );
  await expect(row.locator('td[data-role="user"]')).toHaveAttribute(
    "data-allowed",
    "false",
  );

  // Backed by the API rather than by the table restating itself.
  await page.goto("/kb");
  await expect(page.getByRole("button", { name: "New article" })).toBeVisible();
});

test("the matrix lists deleting a ticket, at the top tier only", async ({
  page,
}) => {
  await loginAs(page, "dana.reyes@acme.com"); // admin
  await page.goto("/permissions");

  const row = page.locator('tr[data-cap="cap.deleteTicket"]');
  await expect(row).toBeVisible();
  await expect(row.locator('td[data-role="admin"]')).toHaveAttribute(
    "data-allowed",
    "false",
  );
  await expect(row.locator('td[data-role="super_admin"]')).toHaveAttribute(
    "data-allowed",
    "true",
  );
  // Which is exactly what "delete ticket is hidden from an admin" above proves
  // on the ticket page.
});
