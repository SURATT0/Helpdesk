import { test, expect, type Page } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * Closing a ticket takes two sides: the desk says the work is done, the person
 * who raised it says whether that is true.
 *
 * What can only be judged here is whether the requester is actually OFFERED the
 * answer — the API-level rules (who may answer, from which status, what gets
 * recorded) live in backend/test/two-sided-closure.integration.test.ts.
 *
 * Each test raises its own ticket rather than borrowing a seeded one. These
 * cases move a ticket through its whole life, so sharing a row would leave the
 * next test to find it in whatever state the last one stopped at.
 */

/**
 * A requester of our own, not one another spec leans on. These tests CLOSE the
 * tickets they raise, and `ticket-history.spec.ts` asserts that Marcus Chen has
 * an empty archive "by construction" — closing one of his here would have made
 * that spec fail from across the suite, which is a hard failure to read.
 */
const REQUESTER = "r.danforth@acme.com";

/** The requester raises a ticket and returns its URL. */
async function requesterRaises(page: Page): Promise<string> {
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByLabel("Subject").fill(`Closure probe ${Date.now()}`);
  await page
    .getByLabel("Description")
    .fill("Raised by the requester, for the closure flow.");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });
  return page.url();
}

/** The desk finishes the work, which is what puts the ball in the requester's court. */
async function deskFinishes(page: Page, url: string) {
  await loginAs(page, DEMO.email); // Dana Reyes, admin
  await page.goto(url);
  await page.getByRole("button", { name: "Done — ask requester" }).click();
  await expect(page.getByText("Pending").first()).toBeVisible();
}

test("the requester is offered the answer, and confirming closes the ticket", async ({
  browser,
}) => {
  const deskCtx = await browser.newContext();
  const requesterCtx = await browser.newContext();
  try {
    const theirs = await requesterCtx.newPage();
    const url = await requesterRaises(theirs);

    const deskPage = await deskCtx.newPage();
    await deskFinishes(deskPage, url);

    await theirs.reload();

    // The two answers, in the requester's words.
    const yes = theirs.getByRole("button", { name: "Yes, it is fixed" });
    await expect(yes).toBeVisible();
    await expect(
      theirs.getByRole("button", { name: "Not fixed yet" }),
    ).toBeVisible();
    // And not the desk's control: finishing the work is not theirs to do.
    await expect(
      theirs.getByRole("button", { name: "Done — ask requester" }),
    ).toHaveCount(0);

    await yes.click();
    await expect(theirs.getByText("Closed").first()).toBeVisible();

    // The desk sees the same thing on its own screen.
    await deskPage.reload();
    await expect(deskPage.getByText("Closed").first()).toBeVisible();
  } finally {
    await deskCtx.close();
    await requesterCtx.close();
  }
});

test("rejecting sends it back with the reason in the thread", async ({
  browser,
}) => {
  const deskCtx = await browser.newContext();
  const requesterCtx = await browser.newContext();
  try {
    const theirs = await requesterCtx.newPage();
    const url = await requesterRaises(theirs);

    const deskPage = await deskCtx.newPage();
    await deskFinishes(deskPage, url);

    await theirs.reload();
    await theirs.getByRole("button", { name: "Not fixed yet" }).click();
    const reason = `Still dropping every ten minutes ${Date.now()}`;
    await theirs.getByLabel("What is still wrong? (optional)").fill(reason);
    await theirs.getByRole("button", { name: "Send it back" }).click();

    // Back with the desk — unfinished again — and the reason is in the thread
    // rather than tucked into a field nobody opens.
    await expect(theirs.getByText(/New|In Progress/).first()).toBeVisible();
    await expect(theirs.getByText(reason)).toBeVisible();

    // Which is the point of it being a public comment: the desk reads it too.
    await deskPage.reload();
    await expect(deskPage.getByText(reason)).toBeVisible();
  } finally {
    await deskCtx.close();
    await requesterCtx.close();
  }
});

test("a ticket that is not waiting on the requester offers them nothing", async ({
  page,
}) => {
  // Freshly raised and nobody has finished it, so there is nothing to confirm —
  // and the buttons must be absent rather than present and refused.
  await requesterRaises(page);

  await expect(page.getByText(/New|In Progress/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Yes, it is fixed" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Not fixed yet" }),
  ).toHaveCount(0);
});
