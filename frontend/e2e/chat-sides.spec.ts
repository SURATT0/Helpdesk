import { test, expect, type Page, type Locator } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * Which side of the conversation a message sits on.
 *
 * It used to be decided by the sender's ROLE — agents right, requesters left —
 * which is the same answer for everybody looking, and therefore the wrong answer
 * for half of them: a requester opened their own ticket and found their own
 * words on the left and the desk's on the right. Whose side a message is on is a
 * fact about who is READING, so every case here checks the same thread twice,
 * once from each end of it.
 *
 * The bubble carries `data-side`, and the geometry is checked as well as the
 * attribute: an attribute that says "mine" on a bubble drawn flush left would
 * pass a test that only read the attribute, and look exactly like the bug.
 */

const AGENT = DEMO.email; // Dana Reyes, admin — assignee of 1042
const OTHER_AGENT = "ana.m@acme.com"; // a second Acme admin, for the left side
const REQUESTER = "marcus.chen@acme.com"; // raised 1042
const TICKET = 1042;
/** Closed, Acme, raised by L. Osei and handled by Dana. */
const CLOSED_TICKET = 1001;
const CLOSED_REQUESTER = "l.osei@acme.com";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The paragraph holding exactly this text.
 *
 * `exact` for two reasons, both of which bit: `getByText` matches a SUBSTRING,
 * so the bubble's own div — whose text is the header plus the body — matches
 * alongside the paragraph and every assertion on the pair is a strict-mode
 * violation. And the match is case-INSENSITIVE, so "Ana here 123" is found
 * inside "D-ana here 123" and a test with two senders picks up the wrong one.
 */
function textOf(page: Page, body: string): Locator {
  return page.getByText(body, { exact: true });
}

/** The bubble holding this text: the paragraph's own parent. */
function bubbleOf(page: Page, body: string): Locator {
  return textOf(page, body).locator("xpath=..");
}

/** Type a chat message and wait for it to appear. */
async function send(page: Page, body: string) {
  const box = page.getByPlaceholder(/Enter to send/);
  await box.waitFor();
  await box.fill(body);
  await box.press("Enter");
  await expect(textOf(page, body)).toBeVisible({ timeout: 15_000 });
}

/**
 * How much room is left on each side of a bubble, inside the thread.
 *
 * The gap is the whole point of the layout — it is the only thing that says
 * which side a message is on — so it is what the assertions read, rather than a
 * class name or a pixel offset that depends on the padding of the day. Note the
 * near gap is never zero: the avatar sits between the bubble and the edge.
 */
async function gaps(page: Page, body: string) {
  const bubble = await bubbleOf(page, body).boundingBox();
  const thread = await page.getByTestId("chat-scroll").boundingBox();
  if (!bubble || !thread) throw new Error(`no box for "${body}"`);
  return {
    left: bubble.x - thread.x,
    right: thread.x + thread.width - (bubble.x + bubble.width),
  };
}

/** The bubble is on the right, with visible daylight down its left. */
async function expectRight(page: Page, body: string) {
  await expect(bubbleOf(page, body)).toHaveAttribute("data-side", "mine");
  const g = await gaps(page, body);
  expect(g.left, `"${body}" should sit right`).toBeGreaterThan(g.right + 40);
}

/** The bubble is on the left, with visible daylight down its right. */
async function expectLeft(page: Page, body: string) {
  await expect(bubbleOf(page, body)).toHaveAttribute("data-side", "theirs");
  const g = await gaps(page, body);
  expect(g.right, `"${body}" should sit left`).toBeGreaterThan(g.left + 40);
}

/** The seeded opening bubble — written by the requester, on every ticket. */
const OPENING = "VPN drops every 10 minutes after 4.2 update (seeded demo ticket).";

test("each reader sees their own messages on the right and the other side's on the left", async ({
  page,
}) => {
  const fromAgent = `From the desk ${Date.now()}`;

  await loginAs(page, AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await send(page, fromAgent);

  // The agent's view: their own reply right, the requester's opening left.
  await expectRight(page, fromAgent);
  await expectLeft(page, OPENING);

  // The requester's view of the SAME thread: the mirror image, which is the
  // whole fix. Keyed on the role, both of these were on the same sides for both
  // people and one of them was always wrong.
  await loginAs(page, REQUESTER);
  await page.goto(`/tickets/${TICKET}`);
  await expectRight(page, OPENING);
  await expectLeft(page, fromAgent);
});

test("two agents on one ticket are told apart by name, not by side", async ({
  page,
}) => {
  // Deliberately not "Dana here" and "Ana here": one is a substring of the
  // other, which is how this test found the matcher's case-insensitive
  // substring rule the hard way.
  const stamp = Date.now();
  const fromDana = `First responder ${stamp}`;
  const fromAna = `Second opinion ${stamp}`;

  await loginAs(page, AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await send(page, fromDana);

  await loginAs(page, OTHER_AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await send(page, fromAna);

  // Read by the requester, both agents are "the other side" — so the side alone
  // cannot say who spoke, and the name in each bubble has to.
  await loginAs(page, REQUESTER);
  await page.goto(`/tickets/${TICKET}`);
  await expectLeft(page, fromDana);
  await expectLeft(page, fromAna);
  await expect(bubbleOf(page, fromDana)).toContainText("Dana Reyes");
  await expect(bubbleOf(page, fromAna)).toContainText("Ana M.");
});

test("a long unbroken string wraps inside the bubble on either side", async ({
  page,
}) => {
  // No spaces at all: the case `whitespace-pre-wrap` alone cannot handle, since
  // it has nowhere to break. A pasted URL or a stack frame is the real version.
  const body = `x${"y".repeat(300)}`;

  await loginAs(page, AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await send(page, body);

  for (const [who, check] of [
    [AGENT, expectRight],
    [REQUESTER, expectLeft],
  ] as const) {
    await loginAs(page, who);
    await page.goto(`/tickets/${TICKET}`);
    await check(page, body);

    const thread = await page.getByTestId("chat-scroll").boundingBox();
    const bubble = await bubbleOf(page, body).boundingBox();
    expect(bubble!.width).toBeLessThanOrEqual(thread!.width * 0.8);
    // And the thread itself did not grow a sideways scrollbar to fit it.
    const overflow = await page
      .getByTestId("chat-scroll")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, `sideways scroll for ${who}`).toBeLessThanOrEqual(1);
  }
});

test("a picture sits on its own bubble's side", async ({ page }) => {
  const body = `With a screenshot ${Date.now()}`;

  await loginAs(page, AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await page
    .getByTestId("composer")
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG });
  await send(page, body);

  const bubble = bubbleOf(page, body);
  const grid = bubble.locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 20_000 });

  // The grid is narrower than the bubble, so it has a side of its own to pick —
  // and left-aligned inside a right-hand bubble it points back the wrong way.
  const inner = await bubble.boundingBox();
  const image = await grid.boundingBox();
  const leftGap = image!.x - inner!.x;
  const rightGap = inner!.x + inner!.width - (image!.x + image!.width);
  expect(leftGap).toBeGreaterThanOrEqual(rightGap);
});

test("the two sides are still tellable apart on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  const body = `Narrow thread ${Date.now()}`;

  await loginAs(page, AGENT);
  await page.goto(`/tickets/${TICKET}`);
  await send(page, body);

  await expectRight(page, body);
  await expectLeft(page, OPENING);

  // Nothing hangs off the edge of the screen, and nothing made the page scroll
  // sideways to accommodate it.
  const thread = await page.getByTestId("chat-scroll").boundingBox();
  const mine = await bubbleOf(page, body).boundingBox();
  expect(mine!.x + mine!.width).toBeLessThanOrEqual(thread!.x + thread!.width + 1);
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

test("a closed ticket keeps its sides after the composer is replaced", async ({
  page,
}) => {
  // Read by the person who raised it, because they are the one the composer is
  // actually taken away from: staff keep it on a closed ticket, collapsed to
  // internal notes, so signing in as an agent would not exercise the swap at
  // all.
  await loginAs(page, CLOSED_REQUESTER);
  await page.goto(`/tickets/${CLOSED_TICKET}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The box to type in is gone, replaced by the notice that the thread is shut.
  await expect(page.getByPlaceholder(/Enter to send/)).toHaveCount(0);

  // Their own opening message is still on their own side.
  const opening = page.getByTestId("chat-scroll").locator("[data-side]").first();
  await expect(opening).toHaveAttribute("data-side", "mine");

  // And the thread still scrolls inside its own box rather than letting the
  // column grow — the arrangement the composer's removal is most likely to
  // disturb, since it was holding the bottom of that column down.
  const scrolls = await page
    .getByTestId("chat-scroll")
    .evaluate((el) => getComputedStyle(el).overflowY);
  expect(scrolls).toBe("auto");
  const thread = await page.getByTestId("chat-scroll").boundingBox();
  const viewport = page.viewportSize()!;
  expect(thread!.height).toBeGreaterThan(0);
  expect(thread!.y + thread!.height).toBeLessThanOrEqual(viewport.height + 1);
});
