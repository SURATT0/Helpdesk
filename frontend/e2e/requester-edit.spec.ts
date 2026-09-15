import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * The requester correcting their own wording, in a browser.
 *
 * The RULES are pinned server-side in requester-edit.integration.test.ts — who
 * may edit, and the moment it stops. What only a browser can answer is whether
 * the affordance is wired to them: that the button appears for the person it is
 * meant for, opens a form holding what they actually wrote, and that saving
 * reaches the API and comes back on the page.
 *
 * The ticket is raised by the test rather than taken from the seed. The seeded
 * ones are shared with every other spec in this suite — several of them post
 * agent replies to #1042 — and a reply is precisely what withdraws this button.
 */

const REQUESTER = "marcus.chen@acme.com";
const AGENT = "dana.reyes@acme.com";

/** Raise a ticket as the signed-in requester and land on its page. */
async function raiseTicket(page: Page, subject: string) {
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.getByLabel("Description").fill("The original description.");
  await dialog.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });
}

test("a requester edits the ticket they just raised", async ({ page }) => {
  await loginAs(page, REQUESTER);
  const original = `Edit probe ${Date.now()}`;
  await raiseTicket(page, original);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The form opens holding what is on the ticket, not an empty box — this is a
  // correction, and retyping it from scratch is not what anybody means by one.
  await expect(dialog.getByLabel("Subject")).toHaveValue(original);

  const corrected = `${original} (corrected)`;
  await dialog.getByLabel("Subject").fill(corrected);
  await dialog.getByRole("button", { name: "Save changes" }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: corrected }),
  ).toBeVisible({ timeout: 10_000 });
});

test("the button goes once the desk has replied", async ({ browser }) => {
  // Two sessions, because the point is that one person's reply changes what the
  // other person is offered.
  const requesterCtx = await browser.newContext();
  const agentCtx = await browser.newContext();
  const requester = await requesterCtx.newPage();
  const agent = await agentCtx.newPage();

  try {
    await loginAs(requester, REQUESTER);
    const subject = `Reply probe ${Date.now()}`;
    await raiseTicket(requester, subject);
    const url = requester.url();

    // Offered to begin with — nobody has said anything yet.
    await expect(
      requester.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();

    await loginAs(agent, AGENT);
    await agent.goto(url);
    await agent.getByPlaceholder(/message|reply/i).first().fill("On it.");
    await agent.getByRole("button", { name: /^Send/ }).click();
    await expect(agent.getByText("On it.")).toBeVisible({ timeout: 10_000 });

    // And gone on the requester's side once that reply lands. Reloaded rather
    // than waited for: what is asserted is the rule, not the live channel.
    await requester.reload();
    await expect(requester.getByText("On it.")).toBeVisible({ timeout: 10_000 });
    await expect(
      requester.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
  } finally {
    await requesterCtx.close();
    await agentCtx.close();
  }
});
