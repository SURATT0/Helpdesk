import { test, expect, type Page, type Route } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * Signing into a second account in the same tab must not show the first
 * account's rows. Nothing in a query key names the signed-in user, so the cache
 * has to be dropped when the session changes — otherwise the desk's whole ticket
 * list is served, from cache, to a requester whose row scope allows only their
 * own tickets.
 *
 * Everything here is a client-side navigation on purpose: signing out is a
 * `router.replace`, and the sign-in that follows another one, so the tab keeps
 * one QueryClient across both sessions. A `page.goto` would reload the document
 * and build a fresh cache, which is exactly the case that never had the bug.
 */

const REQUESTER = "marcus.chen@acme.com";
const ROW_ID = /^#\d+$/;

/** The ticket list itself, not the per-ticket sub-resources under the same path. */
const isTicketList = (url: URL) => /\/api\/v1\/tickets(\?|$)/.test(url.href);

/** Fill in the login form that is already on screen — no reload. */
async function signInHere(page: Page, email: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a second sign-in never renders the first session's tickets", async ({
  page,
}) => {
  await loginAs(page, DEMO.email); // Dana Reyes, admin: the whole customer
  await page.getByRole("link", { name: "Tickets" }).click();
  // Polled, not counted once: the rows arrive over a couple of frames, and a
  // single count can land mid-render.
  await expect
    .poll(() => page.getByText(ROW_ID).count())
    // The desk's list is many tickets; the requester below has a handful.
    .toBeGreaterThan(5);
  const deskRowCount = await page.getByText(ROW_ID).count();

  // Hold the next session's list open. With the request unanswered, anything
  // that appears in the table can only have come from the previous session's
  // cache — which is exactly the bug, and what makes it observable at all:
  // served for staleTime without so much as a refetch, it is otherwise a flash.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => isTicketList(url),
    async (route: Route) => {
      await held;
      await route.continue();
    },
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await signInHere(page, REQUESTER);

  await page.getByRole("link", { name: "Tickets" }).click();
  // Asserted as a positive — the table is LOADING — rather than as "no rows are
  // visible": an assertion on an absence passes on its first poll, which here is
  // the frame before React has painted the cached rows, so it would hold whether
  // the cache was dropped or not. A loading row, by contrast, only appears when
  // the query genuinely has no data to show.
  await expect(page.getByText("Loading…")).toBeVisible();
  await expect(page.getByText(ROW_ID)).toHaveCount(0);

  release();
  await expect(page.getByText(ROW_ID).first()).toBeVisible();
  expect(await page.getByText(ROW_ID).count()).toBeLessThan(deskRowCount);
});
