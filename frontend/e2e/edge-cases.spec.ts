import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Negative & edge-case round for the create-ticket path in the browser.
 *
 * The API-level edges live in backend/test/edge-cases.integration.test.ts; what
 * can only be judged here is what the *dialog* does — whether an impatient
 * double-click sends the request twice, whether a retry after a lost response
 * leaves two tickets, and whether a stale second screen is told it lost.
 */

/**
 * The dialog's title is a styled div, not a heading, so the Subject field is
 * what we wait on — it is also the thing the next step needs to be present.
 */
async function openCreateModal(page: Page) {
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByLabel("Subject")).toBeVisible();
}

async function fillForm(page: Page, subject: string, description: string) {
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Description").fill(description);
}

// ---------------------------------------------------------------------------
// 1. Double submit
// ---------------------------------------------------------------------------

/**
 * First of the two defences against a duplicate, and the cheap one: the button
 * is `disabled` while the mutation is pending, so the second press never
 * becomes a request at all. This pins that the guard holds at the timings a
 * hand actually produces.
 *
 * The second defence is the idempotency key, which covers what a disabled
 * button cannot — a request that WAS sent and whose answer was lost. That one
 * is exercised by the lost-response test at the bottom of this file.
 */
test("a real double-click sends only one create request", async ({ page }) => {
  await login(page);

  let posts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/v1/tickets")) {
      posts++;
    }
  });

  /**
   * Hold the create open until this test lets it go, so the second click is
   * guaranteed to land while the first is still in flight.
   *
   * A timed hold (`sleep 2s`, then continue) does not guarantee that: under a
   * parallel run the response could still beat the second click, and then the
   * dialog was already gone and the click landed on nothing — which looks
   * exactly like the guard working, because no second request was sent either.
   */
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => /\/api\/v1\/tickets(\?|$)/.test(url.href),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await held;
      await route.continue();
    },
  );

  await openCreateModal(page);
  await fillForm(page, `Double click probe ${Date.now()}`, "Clicked twice.");

  // Two presses 60ms apart — a brisk human double-click. Both go through the
  // locator, which re-finds the button at click time; the second is `force`d so
  // it is delivered to the button while DISABLED instead of waiting for it to
  // come back, which is the case under test.
  //
  // Not page.mouse coordinates: measuring the box before the first click and
  // reusing the numbers is a trap. The dialog reflows (the KB deflection panel
  // renders late), the stale point lands on the backdrop instead of the button,
  // the backdrop CLOSES the dialog — and the test then reads as "the guard
  // worked", because no second request was sent and no first one either.
  // Matched on either label: the button renames itself to "Creating…" while the
  // mutation is in flight, so a locator pinned to "Create ticket" stops matching
  // the moment the first press lands — which reads as the dialog having vanished.
  const submit = page.getByRole("button", { name: /Create ticket|Creating/ });
  await submit.click();
  // The press landed and the create is in flight: same button, new label, and
  // disabled — which is the guard this test is about.
  await expect(submit).toHaveText(/Creating/);
  await expect(submit).toBeDisabled();
  await page.waitForTimeout(60);
  await submit.click({ force: true });

  // Only now may the server answer, so the count above is settled: whatever the
  // second press did, it did while the first was unanswered.
  expect(posts).toBe(1);
  release();
  await expect(page).toHaveURL(/\/tickets\/\d+/, { timeout: 20_000 });
  expect(posts).toBe(1);
});

// ---------------------------------------------------------------------------
// 2. Hostile text in the form
// ---------------------------------------------------------------------------

test("emoji and Thai text survive the round trip and render on the ticket", async ({
  page,
}) => {
  await login(page);
  await openCreateModal(page);
  const subject = `เครื่องพิมพ์เสีย 🖨️💥 ${Date.now()}`;
  await fillForm(page, subject, "รายละเอียด: กำ ก้ำ ก๊ำ · 👨‍👩‍👧‍👦 · مرحبا");
  await page.getByRole("button", { name: "Create ticket" }).click();

  await expect(page).toHaveURL(/\/tickets\/\d+/, { timeout: 15_000 });
  await expect(page.getByText(subject).first()).toBeVisible();
});

test("the subject field stops at the cap the API enforces", async ({ page }) => {
  await login(page);
  await openCreateModal(page);

  // Paste far more than the 200-char cap. The field mirrors the server bound,
  // so this is refused while typing rather than after submitting — where the
  // only feedback the dialog can give is a flat "Invalid request".
  const subject = page.getByLabel("Subject");
  await subject.fill("A".repeat(5_000));
  expect((await subject.inputValue()).length).toBe(200);
});

test("a subject at the maximum length does not break the ticket page layout", async ({
  page,
}) => {
  await login(page);
  await openCreateModal(page);
  // The longest subject the API accepts, with no spaces in it: the hardest case
  // for a text container, since there is no break opportunity to use.
  const subject = "A".repeat(200);
  await fillForm(page, subject, "Long unbroken subject probe.");
  await page.getByRole("button", { name: "Create ticket" }).click();

  await expect(page).toHaveURL(/\/tickets\/\d+/, { timeout: 15_000 });

  // The page must not scroll sideways — an unbroken 2k-char string that widens
  // the document is the classic symptom.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// 1b. Back, then submit again
// ---------------------------------------------------------------------------

test("going back after a create does not resubmit the form", async ({
  page,
}) => {
  await login(page);
  await openCreateModal(page);
  const subject = `Back button probe ${Date.now()}`;
  await fillForm(page, subject, "Created once, then navigated back.");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+/, { timeout: 15_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/tickets(\?|$)/);

  // The dialog must not come back holding the submitted values — that is the
  // shape of an accidental duplicate.
  await expect(page.getByLabel("Subject")).toHaveCount(0);

  // And exactly one ticket carries the subject.
  await page
    .getByPlaceholder("Search subject, #id, requester…")
    .fill(subject);
  await expect(page.getByText(subject, { exact: false })).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// 3. The same ticket open on two screens
// ---------------------------------------------------------------------------

test("a stale second screen is refused with the server's reason, not a silent no-op", async ({
  browser,
}) => {
  // Two independent contexts = two browsers, each with its own session.
  const a = await browser.newContext();
  const b = await browser.newContext();
  const screenA = await a.newPage();
  const screenB = await b.newPage();

  try {
    await login(screenA);
    await openCreateModal(screenA);
    await fillForm(
      screenA,
      `Two screen probe ${Date.now()}`,
      "Edited from two places at once.",
    );
    await screenA.getByRole("button", { name: "Create ticket" }).click();
    await expect(screenA).toHaveURL(/\/tickets\/\d+/, { timeout: 15_000 });
    const url = screenA.url();

    // The badge shows the DERIVED state, which is New or In Progress depending on
    // whether routing put someone on the new ticket — either way it is unfinished,
    // which is what both screens start out agreeing on.
    const unfinished = /New|In Progress/;
    await expect(screenA.getByText(unfinished).first()).toBeVisible();

    await login(screenB);
    await screenB.goto(url);
    await expect(screenB.getByText(unfinished).first()).toBeVisible();

    // Screen A closes it outright — the desk raised this one itself, so there is
    // nobody to confirm and `new → closed` is a legal end.
    await screenA.getByRole("button", { name: unfinished }).first().click();
    await screenA.getByRole("button", { name: /^Closed$/ }).click();
    await expect(screenA.getByText("Closed").first()).toBeVisible();

    // Screen B still believes it is unfinished and offers Pending. The server must
    // refuse it — closed → pending is not in the whitelist, a closed ticket can
    // only be reopened — and screen B must SAY so rather than appear to work.
    await screenB.getByRole("button", { name: unfinished }).first().click();
    await screenB.getByRole("button", { name: /^Pending$/ }).click();
    // The exact sentence, so this cannot pass on some other error appearing:
    // the 409 has to name the transition the stale screen actually attempted.
    await expect(
      screenB
        .getByText('Cannot move ticket from "closed" to "pending"')
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await a.close();
    await b.close();
  }
});

/**
 * The case an idempotency key exists for: the create REACHED the server and
 * succeeded, but the response never made it back. The dialog can only report a
 * failure, so the person presses the button again — and without a key that
 * second press raises a second ticket for the same problem.
 */
test("a retry after a lost response lands on one ticket, not two", async ({
  page,
}) => {
  await login(page);

  // Both attempts must actually REACH the server — otherwise "one ticket" would
  // be true for the boring reason that only one create was ever attempted, and
  // this test would pass without exercising idempotency at all.
  let serverSawCreates = 0;
  let swallowedOne = false;
  await page.route("**/api/v1/tickets", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (!swallowedOne) {
      swallowedOne = true;
      // Let the server do the work, then drop the reply on the floor.
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      serverSawCreates++;
      await route.abort("failed");
      return;
    }
    serverSawCreates++;
    await route.fallback();
  });

  await openCreateModal(page);
  const subject = `Lost response probe ${Date.now()}`;
  await fillForm(page, subject, "The first reply never came back.");

  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByText("Cannot reach the server")).toBeVisible({
    timeout: 10_000,
  });

  // Same content, so the same key — the retry is answered with the ticket the
  // first attempt already created.
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+/, { timeout: 15_000 });

  // Two creates hit the server, and exactly one ticket came of them.
  expect(serverSawCreates).toBe(2);
  await page.goto("/tickets");
  await page.getByPlaceholder("Search subject, #id, requester…").fill(subject);
  await expect(page.getByText(subject, { exact: false })).toHaveCount(1);
});
