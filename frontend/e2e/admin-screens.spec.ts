import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * The two admin screens this milestone added: the project's own page, and the
 * directory's filters.
 *
 * The approval QUEUE is deliberately not driven here. It only appears when
 * somebody has actually registered and is still waiting, and manufacturing that
 * state through the UI means walking the whole sign-up flow — which the backend
 * suite already covers end to end, including the parts a browser cannot see (the
 * mailed token, the audit row, the refusal to decide twice). What this file adds
 * is the half that only a browser can answer: that the screens render, link up,
 * and narrow what they show.
 */

const PLATFORM = "sam.rivera@acme.com"; // platform-wide super admin
const AGENT = "dana.reyes@acme.com"; // admin, inside Acme

test.describe("a project has a page of its own", () => {
  test("the list links to it, and it shows the work filed under it", async ({
    page,
  }) => {
    await loginAs(page, PLATFORM);
    await page.goto("/projects");

    const first = page.getByRole("link", { name: "Acme Migration" });
    await expect(first).toBeVisible();
    await first.click();

    await expect(page).toHaveURL(/\/projects\/\d+/);
    await expect(
      page.getByRole("heading", { name: "Acme Migration" }),
    ).toBeVisible();
    await expect(page.getByText("About this project")).toBeVisible();
    // The seeded projects have no description, and that is a real state rather
    // than a missing one — the page has to say so rather than render an empty box.
    await expect(
      page.getByText("No description has been written yet."),
    ).toBeVisible();
  });

  test("refuses an id that is not the reader's to see", async ({ page }) => {
    await loginAs(page, AGENT);
    // Far beyond anything seeded. The server 404s it; the page must say so
    // rather than sit on a spinner or render an empty project.
    await page.goto("/projects/999999");
    await expect(
      page.getByText(/doesn't exist, or isn't yours to see/i),
    ).toBeVisible();
  });
});

test.describe("a project can be created with a description", () => {
  test("the description written at creation appears on its page", async ({
    page,
  }) => {
    await loginAs(page, PLATFORM);
    await page.goto("/projects");

    // A name nothing else uses, so repeated local runs do not collide on the
    // per-customer unique name.
    const name = `E2E Project ${Date.now()}`;
    await page.getByRole("button", { name: "New project" }).click();
    // A platform-wide admin has no customer of their own, so the form makes them
    // say which tenant this is for — the server refuses the create without one.
    await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Acme Corp" });
    await page.getByPlaceholder("Project name").fill(name);
    await page
      .getByPlaceholder(/What is this project/i)
      .fill("## Scope\n\n- Migrate the mail server\n- Retire the old queue");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(/\/projects\/\d+/);
    // Rendered as markdown-lite, so the heading is a heading and the bullets are
    // list items — not the raw "## " text.
    await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Migrate the mail server" }),
    ).toBeVisible();
  });
});

test.describe("the user directory narrows", () => {
  test("searches name and email, and clears again", async ({ page }) => {
    await loginAs(page, PLATFORM);
    await page.goto("/users");

    const rows = page.getByText("marcus.chen@acme.com");
    await expect(rows).toBeVisible();

    await page.getByPlaceholder("Name or email").fill("owen");
    await expect(page.getByText("owen.park@acme.com")).toBeVisible();
    await expect(rows).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(rows).toBeVisible();
  });

  test("filters by role", async ({ page }) => {
    await loginAs(page, PLATFORM);
    await page.goto("/users");

    await page.getByLabel("Role", { exact: true }).selectOption("user");
    // Every remaining row is a requester. Checking the absence of a known admin
    // is the cheap version of asserting the whole column.
    await expect(page.getByText("dana.reyes@acme.com")).toHaveCount(0);
    await expect(page.getByText("marcus.chen@acme.com")).toBeVisible();
  });

  /**
   * The customer filter, from both sides of the reach boundary.
   *
   * TWO tests rather than one that signs in twice, and the split is the fix for
   * a real race rather than a style choice: signing a second person in on the
   * same page means visiting /login while the first session is still live, and
   * that page redirects an authenticated visitor to /dashboard. The form renders
   * for an instant and is then torn out from under the click — which is exactly
   * how it failed, intermittently and only under CI's timing. Playwright gives
   * each test its own context, so neither one inherits a session.
   */
  test("offers it to someone who reaches more than one customer", async ({
    page,
  }) => {
    await loginAs(page, PLATFORM);
    await page.goto("/users");
    // Exact, because every row also carries a "Customer access for …" button —
    // a substring match would find nine controls and mean nothing.
    await expect(page.getByLabel("Customer", { exact: true })).toBeVisible();
  });

  test("withholds it from someone inside a single customer", async ({
    page,
  }) => {
    // Dana is Acme's own admin: every row would carry the same customer, so the
    // filter would offer a choice with one answer.
    await loginAs(page, AGENT);
    await page.goto("/users");
    await expect(page.getByLabel("Customer", { exact: true })).toHaveCount(0);
    // Proves the page actually loaded, so the assertion above is about the
    // filter being absent rather than about nothing having rendered yet.
    await expect(page.getByPlaceholder("Name or email")).toBeVisible();
  });
});
