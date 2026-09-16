import { test, expect, type Page } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * Two endings the desk does not own, in the browser.
 *
 * What can only be judged here is whether the person is actually OFFERED the
 * way out, and whether the composer goes away when there is nothing left to
 * write. The rules themselves — who may cancel, from which status, what the
 * server refuses — live in
 * backend/test/cancel-and-locked-chat.integration.test.ts.
 *
 * Each test raises its own ticket rather than borrowing a seeded one: these
 * cases end the tickets they touch, and sharing a row would leave the next test
 * to find it cancelled.
 */

const REQUESTER = "r.danforth@acme.com";
const CHAT_BOX = /Enter to send/;

/** The requester raises a ticket and returns its URL. */
async function requesterRaises(page: Page): Promise<string> {
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByLabel("Subject").fill(`Cancel probe ${Date.now()}`);
  await page
    .getByLabel("Description")
    .fill("Raised by the cancel / locked-chat spec.");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });
  return page.url();
}

test("the requester can withdraw a ticket the desk has not moved", async ({
  page,
}) => {
  await requesterRaises(page);

  await page.getByRole("button", { name: "Cancel request" }).first().click();
  const reason = `Sorted it myself ${Date.now()}`;
  await page.getByLabel("Why are you cancelling? (optional)").fill(reason);
  // Scoped to the dialog: the header button that opened it carries the same
  // label, and choosing between the two by DOM position is exactly the kind of
  // thing that breaks when the dialog moves in the tree.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();

  // Its own badge, not Closed — the two endings have to be told apart.
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  await expect(page.getByText(reason)).toBeVisible();
});

test("a cancelled ticket takes no more messages, and says so", async ({
  page,
}) => {
  await requesterRaises(page);
  await page.getByRole("button", { name: "Cancel request" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await expect(page.getByText("Cancelled").first()).toBeVisible();

  // The composer is gone, and something readable stands where it was — a box
  // that simply vanishes reads as a page that failed to load.
  await expect(page.getByPlaceholder(CHAT_BOX)).toHaveCount(0);
  await expect(page.getByText(/This request was cancelled/)).toBeVisible();
});

test("the desk is never offered Cancelled on the status menu", async ({
  page,
}) => {
  const url = await requesterRaises(page);

  await loginAs(page, DEMO.email); // Dana Reyes, admin
  await page.goto(url);
  // Open the status control in the properties rail.
  await page.getByRole("button", { name: /New|In Progress/ }).first().click();
  await expect(page.getByText("Move to")).toBeVisible();

  // Pending and Closed are the desk's endings. Withdrawing is the requester's,
  // and the API refuses the value on this route — offering it would be offering
  // a move that 400s.
  await expect(page.getByRole("button", { name: /^Pending$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Closed$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cancelled$/ })).toHaveCount(0);
});

test("a closed ticket keeps the note tab for staff but loses the public thread", async ({
  page,
}) => {
  const url = await requesterRaises(page);

  await loginAs(page, DEMO.email);
  await page.goto(url);
  await page.getByRole("button", { name: /New|In Progress/ }).first().click();
  await page.getByRole("button", { name: /^Closed$/ }).click();
  // `new → closed` finishes the work, so it asks what was done before it moves.
  await page.getByLabel("How it was fixed").fill("Handled and closed.");
  await page.getByRole("button", { name: "Close ticket" }).click();
  await expect(page.getByText("Closed").first()).toBeVisible();

  // No chat box: an agent's public message would email somebody about a ticket
  // they cannot answer.
  await expect(page.getByPlaceholder(CHAT_BOX)).toHaveCount(0);
  // But the note tab stays — the desk's own record of what happened is often
  // written after the fact, and filing one must not need a reopen.
  await expect(page.getByRole("button", { name: "Internal note" })).toBeVisible();
});

test("the requester loses the way out once the desk has moved it", async ({
  page,
}) => {
  const url = await requesterRaises(page);

  await loginAs(page, DEMO.email);
  await page.goto(url);
  await page.getByRole("button", { name: "Done — ask requester" }).click();
  await page.getByLabel("How it was fixed").fill("Replaced the dock.");
  await page.getByRole("button", { name: "Send to requester" }).click();
  await expect(page.getByText("Pending").first()).toBeVisible();

  await loginAs(page, REQUESTER);
  await page.goto(url);
  // Their answer to the closure is offered; withdrawing is not, because the desk
  // has done the work by now.
  await expect(page.getByRole("button", { name: "Yes, it is fixed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
});
