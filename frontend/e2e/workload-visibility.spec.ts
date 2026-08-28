import { test, expect, type Page } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The Assignee FACET chip, not the table's Assignee sort header — "Assignee"
 * alone matches both and trips strict mode. The chip carries a leading ＋ while
 * no assignee is selected, which is the state every test here opens in.
 */
const assigneeFacet = (page: Page) =>
  page.getByRole("button", { name: "＋ Assignee", exact: true });

/**
 * Per-agent workload on screen: who is shown the table, and — more to the point
 * — that an agent's Reports page does not CONTAIN it.
 *
 * Every assertion about the agent's view is an absence assertion, deliberately.
 * `toBeHidden()` would pass on an element that is present in the DOM with its
 * data already fetched and merely styled away, which is the outcome this work
 * exists to avoid: the reader can still read it, they just have to open dev
 * tools. So these count nodes, not visibility.
 */

// `login()` signs in as Dana Reyes — the demo agent (role `admin`).
const SUPERUSER = "morgan.lee@acme.com"; // super_admin, Acme

test("an agent's Reports page contains no per-agent table at all", async ({
  page,
}) => {
  await login(page); // Dana Reyes
  await page.goto("/reports");

  // The page itself rendered — this is not passing because nothing loaded.
  await expect(page.getByText("SLA compliance", { exact: true })).toBeVisible();

  // Absent, not hidden: zero nodes anywhere in the document.
  await expect(page.getByText("Throughput by agent")).toHaveCount(0);
  await expect(page.getByText("AGENT", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-agent-row]")).toHaveCount(0);
  // And no door to it either — no disabled button, no "no access" placeholder.
  await expect(page.getByRole("link", { name: "By agent" })).toHaveCount(0);
  await expect(page.getByText(/don't have access/i)).toHaveCount(0);

  // The team-wide sections that were never in scope are untouched.
  await expect(page.getByText("SLA compliance by category")).toBeVisible();
});

test("the metrics an agent should keep are still on the page", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports");

  // Three KPI tiles, the trend chart and both team-wide tables.
  await expect(page.getByText("Average Handling Time")).toBeVisible();
  await expect(page.getByText("First Response Time")).toBeVisible();
  await expect(page.getByText("Tickets per day")).toBeVisible();
  await expect(page.getByText("SLA compliance by priority")).toBeVisible();
  await expect(page.getByText("SLA compliance by category")).toBeVisible();
});

test("a super admin gets the link, the page and the table", async ({ page }) => {
  await loginAs(page, SUPERUSER);
  await page.goto("/reports");

  const link = page.getByRole("link", { name: "By agent" });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(/\/reports\/workload/);
  await expect(page.getByText("Throughput by agent")).toBeVisible();
  // Real rows, more than one person — this is the comparison view.
  await expect(page.locator("[data-agent-row]").first()).toBeVisible();
  expect(await page.locator("[data-agent-row]").count()).toBeGreaterThan(1);
});

test("an agent typing the URL is sent back to Reports with a short line", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports/workload");

  await expect(page).toHaveURL(/\/reports\?denied=1/);
  await expect(page.getByText("You don't have access to this report")).toBeVisible();
  // Sent somewhere useful, not to an empty error page.
  await expect(page.getByText("SLA compliance", { exact: true })).toBeVisible();
  // The redirect must not leave the table behind on the way past.
  await expect(page.locator("[data-agent-row]")).toHaveCount(0);

  // Dismissing clears the param, so a refresh does not bring the notice back.
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByText("You don't have access to this report")).toHaveCount(0);
});

test("a requester is refused the same way", async ({ page }) => {
  await loginAs(page, "marcus.chen@acme.com");
  await page.goto("/reports/workload");
  await expect(page).toHaveURL(/\/reports\?denied=1/);
  await expect(page.locator("[data-agent-row]")).toHaveCount(0);
});

/**
 * The indirect channel, which matters more than the report: filtering the ticket
 * list to one person turns every count on the page — the footer's "x of y", the
 * SLA tiles, the board's column headers — into that person's workload.
 */
test("an agent's assignee facet offers only themselves and the unassigned queue", async ({
  page,
}) => {
  await login(page); // Dana Reyes
  await page.goto("/tickets");

  await assigneeFacet(page).click();
  const menu = page.getByRole("dialog", { name: "Assignee" });
  // The option rows are the panel's buttons; the sheet's close button is
  // `lg:hidden`, so at desktop width it is out of the accessibility tree.
  const options = menu.getByRole("button");

  // Colleagues are not offered.
  await expect(menu.getByText("Ana M.")).toHaveCount(0);
  await expect(menu.getByText("Kai T.")).toHaveCount(0);
  // What remains: the unassigned queue, and yourself.
  await expect(menu.getByText("Unassigned")).toBeVisible();
  await expect(menu.getByText("Dana Reyes")).toBeVisible();
  await expect(options).toHaveCount(2);
});

test("a super admin's assignee facet still lists the whole desk", async ({
  page,
}) => {
  await loginAs(page, SUPERUSER);
  await page.goto("/tickets");

  await assigneeFacet(page).click();
  const menu = page.getByRole("dialog", { name: "Assignee" });
  await expect(menu.getByText("Dana Reyes")).toBeVisible();
  await expect(menu.getByText("Ana M.")).toBeVisible();
  // Managing the desk means being able to point the filter at anyone on it.
  expect(await menu.getByRole("button").count()).toBeGreaterThan(2);
});
