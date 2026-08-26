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

  // Hold the create request open so the second click lands while the first is
  // still in flight — otherwise the response returns first and there is no race.
  await page.route("**/api/v1/tickets", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise((r) => setTimeout(r, 2_000));
    await route.fallback();
  });

  await openCreateModal(page);
  await fillForm(page, `Double click probe ${Date.now()}`, "Clicked twice.");

  // Real mouse clicks 60ms apart — a brisk human double-click. Driven through
  // page.mouse rather than locator.click so the second click is still delivered
  // to the (now disabled) button instead of waiting for it to become enabled.
  const box = (await page
    .getByRole("button", { name: "Create ticket" })
    .boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(60);
  await page.mouse.click(x, y);

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

    // Both screens now agree the ticket is `open`.
    await screenA.getByRole("button", { name: /New/i }).first().click();
    await screenA.getByRole("button", { name: /^Open$/ }).click();
    await expect(screenA.getByText("Open").first()).toBeVisible();

    await login(screenB);
    await screenB.goto(url);
    await expect(screenB.getByText("Open").first()).toBeVisible();

    // Screen A finishes the ticket.
    await screenA.getByRole("button", { name: /Open/i }).first().click();
    await screenA.getByRole("button", { name: /^Resolved$/ }).click();
    await expect(screenA.getByText("Resolved").first()).toBeVisible();

    // Screen B still believes it is `open` and offers `pending`. The server must
    // refuse it — resolved → pending is not in the whitelist — and screen B must
    // SAY so rather than appear to have worked.
    await screenB.getByRole("button", { name: /Open/i }).first().click();
    await screenB.getByRole("button", { name: /^Pending$/ }).click();
    // The exact sentence, so this cannot pass on some other error appearing:
    // the 409 has to name the transition the stale screen actually attempted.
    await expect(
      screenB
        .getByText('Cannot move ticket from "resolved" to "pending"')
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
