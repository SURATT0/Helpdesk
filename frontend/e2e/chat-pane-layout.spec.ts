import { test, expect, type Page } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The chat pane's geometry: the conversation scrolls, the composer does not move.
 *
 * The composer used to be the last child of the scrolling conversation, which
 * gave it two faults at once. Flexbox squeezed it — a flex child's automatic
 * minimum is its content size, so the message list would not shrink and the
 * parent took the height it needed out of the only sibling that would yield —
 * and whatever height survived scrolled away with the messages, so on a long
 * thread you had to scroll to the bottom to reach the box you were typing into.
 *
 * These assertions are geometric on purpose. The arrangement IS the feature, and
 * it is exactly the kind of thing a later Tailwind edit undoes with nothing
 * noticing: drop one `min-h-0` and the whole page starts scrolling again.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 800 };
const CHAT_BOX = /Enter to send/;

/**
 * A ticket of this spec's own, raised BY A REQUESTER, for the cases that post
 * into the thread.
 *
 * Not seeded 1042: the suite is `fullyParallel`, several specs read that ticket,
 * and dropping a dozen probe messages into it from here is how a shared fixture
 * turns into cross-spec flake. The read-only measurements below still use 1042,
 * which they cannot disturb.
 *
 * And not raised as the demo AGENT, which is what this did first: a ticket
 * raised by staff has no external side (`isInternalThread`), so its composer is
 * note-only and there is no "Enter to send" box on it at all. The chat pane is
 * what this spec measures, so the ticket has to be one that HAS a chat.
 */
const REQUESTER = "r.danforth@acme.com";

async function ownTicket(page: Page): Promise<void> {
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByLabel("Subject").fill(`Chat layout probe ${Date.now()}`);
  await page
    .getByLabel("Description")
    .fill("Raised by the chat pane layout spec.");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });
}

/** Post `n` chat messages through the composer, as a person would. */
async function fillThread(page: Page, n: number) {
  const composer = page.getByPlaceholder(CHAT_BOX);
  await expect(composer).toBeVisible();
  for (let i = 0; i < n; i++) {
    await composer.fill(`Layout probe ${Date.now()}-${i}`);
    await composer.press("Enter");
    // Wait for the optimistic row rather than a timeout: the next fill has to
    // land in a cleared box, and `fill` on a box the send has not emptied yet
    // silently concatenates.
    await expect(composer).toHaveValue("", { timeout: 10_000 });
  }
}

/** Does the document itself scroll? It must not, at any width. */
const pageScrolls = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight + 1,
  );

test("a long thread scrolls inside the pane and leaves the composer alone", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await ownTicket(page);

  const chat = page.getByTestId("chat-scroll");
  const composer = page.getByPlaceholder(CHAT_BOX);
  await expect(chat).toBeVisible();
  await expect(composer).toBeVisible();

  const before = await composer.boundingBox();
  expect(before).toBeTruthy();

  // Enough to overflow the pane at 900px tall. The ticket is newly raised, so
  // the only thing above these is its opening description.
  await fillThread(page, 12);

  // 1. The conversation overflows and owns a scrollbar of its own.
  const overflows = await chat.evaluate(
    (el) => el.scrollHeight > el.clientHeight + 1,
  );
  expect(overflows, "the conversation is not scrolling internally").toBe(true);

  // 2. The document does not scroll — the page is not growing with the thread.
  expect(await pageScrolls(page), "the page scrolled with the thread").toBe(
    false,
  );

  // 3. The composer is exactly the size it was. This is the regression: it used
  //    to lose height to the message list as the thread grew.
  const after = await composer.boundingBox();
  expect(after).toBeTruthy();
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);

  // 4. And it is still fully on screen, not below the fold.
  expect(after!.y + after!.height).toBeLessThanOrEqual(DESKTOP.height + 1);
});

test("the composer sits below the conversation and inside it, not over the page", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto("/tickets/1042");

  const chat = page.getByTestId("chat-scroll");
  const composer = page.getByPlaceholder(CHAT_BOX);
  const rail = page.getByText("Properties").first();

  const [c, co, r] = await Promise.all([
    chat.boundingBox(),
    composer.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(c && co && r).toBeTruthy();

  // Beneath the conversation, not overlapping it.
  expect(co!.y).toBeGreaterThanOrEqual(c!.y + c!.height - 1);
  // Pinned within the thread COLUMN, not across the viewport: the properties
  // rail is to its right and must not be covered. This is what a
  // `position: fixed` bar would break, which is why it is asserted.
  expect(co!.x + co!.width).toBeLessThanOrEqual(r!.x + 1);
});

test("an unbroken 400-character word wraps instead of widening the page", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await ownTicket(page);

  const composer = page.getByPlaceholder(CHAT_BOX);
  await expect(composer).toBeVisible();
  await composer.fill("x".repeat(400));
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 10_000 });

  // Nothing may scroll sideways — not the pane, not the document.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const chatOverflow = await page
    .getByTestId("chat-scroll")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(chatOverflow).toBeLessThanOrEqual(1);
});

test("the text box grows with what is typed, then stops and scrolls itself", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto("/tickets/1042");

  const composer = page.getByPlaceholder(CHAT_BOX);
  await expect(composer).toBeVisible();
  // The empty height is the `rows` floor, which the auto-grow must not collapse.
  const base = (await composer.boundingBox())!.height;

  // Four lines: past the two `rows` the chat tab asks for, still under the cap.
  await composer.fill("one\ntwo\nthree\nfour");
  const grown = (await composer.boundingBox())!.height;
  expect(grown).toBeGreaterThan(base);

  // Deleting shrinks it back, rather than the box only ever growing.
  await composer.fill("one");
  expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(base + 1);

  // Twenty: the cap holds, and the element scrolls its own content rather than
  // growing without limit and pushing the conversation off screen.
  await composer.fill(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
  const many = (await composer.boundingBox())!.height;
  expect(many).toBeLessThan(grown * 3);
  expect(
    await composer.evaluate((el) => el.scrollHeight > el.clientHeight + 1),
  ).toBe(true);
  // And the page still does not scroll because of it.
  expect(await pageScrolls(page)).toBe(false);
});

test("on a phone the composer is reachable and the thread still has room", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await ownTicket(page);

  const chat = page.getByTestId("chat-scroll");
  const composer = page.getByPlaceholder(CHAT_BOX);
  await expect(chat).toBeVisible();
  await expect(composer).toBeVisible();

  await fillThread(page, 8);

  // The page does not scroll, so the composer cannot be below the fold.
  expect(await pageScrolls(page)).toBe(false);
  const co = (await composer.boundingBox())!;
  expect(co.y + co.height).toBeLessThanOrEqual(PHONE.height + 1);

  // The send and attach controls are on screen, not off the right edge.
  for (const name of [/^Send$/, /Attach/i]) {
    const control = page.getByRole("button", { name }).last();
    if (await control.count()) {
      const b = (await control.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width + 1);
    }
  }

  // Room left to actually read: at least ~3 messages' worth of conversation.
  const c = (await chat.boundingBox())!;
  expect(c.height, "the conversation was squeezed to nothing").toBeGreaterThan(
    180,
  );
});

test("the properties rail folds away on a phone and is open on a desktop", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets/1042");

  // Phone: folded, and opening it is what reveals the rail. The thread fills
  // the screen, so there is no scrolling past it to reach this any more.
  await page.setViewportSize(PHONE);
  const toggle = page.getByRole("button", { name: "Ticket details" });
  await expect(toggle).toBeVisible();
  await expect(page.getByText("Properties").first()).toBeHidden();
  await toggle.click();
  await expect(page.getByText("Properties").first()).toBeVisible();

  // Desktop: no fold-out at all, and the rail is simply there.
  await page.setViewportSize(DESKTOP);
  await expect(toggle).toBeHidden();
  await expect(page.getByText("Properties").first()).toBeVisible();
});
