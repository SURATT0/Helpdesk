import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Images inside chat bubbles.
 *
 * Each test uploads its own files through the composer, so what is exercised is
 * the whole path a person takes: pick files, send a message, watch the thumbnails
 * appear in that message's bubble.
 *
 * A PNG is built here rather than read from disk — a fixture file would be one
 * more thing to keep in step, and the bytes have to be a real PNG or the
 * server's magic-byte check refuses them (which is the point of E-05 below).
 */

/** A real 1x1 PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const TICKET = 1042;

/**
 * Put files on the COMPOSER's hidden input.
 *
 * Scoped to the chat pane: the sidebar has a file input of its own, and an
 * unscoped selector matches both. They are also not interchangeable — the
 * sidebar's upload is ticket-level, so a file added there is deliberately
 * attached to no message and would never appear in a bubble.
 */
async function attach(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await page
    .getByTestId("chat-scroll")
    .locator('input[type="file"]')
    .setInputFiles(files);
}

const png = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(PNG_BASE64, "base64"),
});

/**
 * The bubble a message's text sits in.
 *
 * The paragraph's direct parent IS the bubble — MessageBubble renders its
 * children straight into it. Climbing further reaches the thread container and
 * every other message's images with it, which is how an "this bubble has no
 * image" assertion silently starts counting the whole conversation.
 */
function bubbleOf(page: Page, body: string) {
  return page.getByText(body).locator("xpath=..");
}

/** Send a message with the given files attached, and wait for the bubble. */
async function sendWith(
  page: Page,
  body: string,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await attach(page, files);
  // Enter sends, which is also how the app documents itself in the placeholder.
  // Clicking the Send button is unreliable here: the file chips push it under
  // the scroll container, which then intercepts the click.
  const box = page.getByPlaceholder(/Enter to send/);
  await box.waitFor();
  await box.fill(body);
  await box.press("Enter");
  await expect(page.getByText(body)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await login(page); // Dana Reyes — assignee of 1042
  await page.goto(`/tickets/${TICKET}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a message with one image shows it in the bubble with a reserved box", async ({
  page,
}) => {
  const body = `one image ${Date.now()}`;
  await sendWith(page, body, [png("error screen.png")]);

  const grid = bubbleOf(page, body).locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect(grid).toHaveAttribute("data-columns", "1");

  const img = grid.locator("img");
  await expect(img).toHaveCount(1);
  // width/height attributes, not just CSS: those are what the browser uses to
  // reserve space before any stylesheet applies, which is the moment a chat
  // scroll gets shoved.
  await expect(img).toHaveAttribute("width", /^\d+$/);
  await expect(img).toHaveAttribute("height", /^\d+$/);
});

test("three images become a grid, not a stack", async ({ page }) => {
  const body = `three images ${Date.now()}`;
  await sendWith(page, body, [png("a.png"), png("b.png"), png("c.png")]);

  const grid = bubbleOf(page, body).locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 20_000 });
  // Two columns for 2-4 images, by design — the assertion here is that it is a
  // grid at all, not that it is three-wide.
  await expect(grid).toHaveAttribute("data-columns", "2");
  await expect(grid.locator("img")).toHaveCount(3);

  // The real assertion behind "not a stack": the first two sit on one row.
  const boxes = await grid.locator("img").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  expect(boxes[0]).toBeCloseTo(boxes[1], 0);
});

test("clicking an image opens the lightbox, and Escape closes it", async ({
  page,
}) => {
  const body = `lightbox ${Date.now()}`;
  await sendWith(page, body, [png("full view.png")]);

  const grid = bubbleOf(page, body).locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 15_000 });
  // Click the wrapping button, not the <img>: the button is the control, and
  // the scroll container can intercept a click aimed at the image itself.
  const thumb = grid.locator("button").first();
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Download|ดาวน์โหลด/ })).toBeVisible();
  // One image, so no arrows to flick through.
  await expect(dialog.getByRole("button", { name: /Previous image/ })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the lightbox offers arrows only when the message had several images", async ({
  page,
}) => {
  const body = `arrows ${Date.now()}`;
  await sendWith(page, body, [png("one.png"), png("two.png")]);

  const grid = bubbleOf(page, body).locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 20_000 });
  const thumb = grid.locator("button").first();
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /Next image/ })).toBeVisible();
  await expect(dialog.getByText(/1 of 2|1 จาก 2/)).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(/2 of 2|2 จาก 2/)).toBeVisible();
});

test("a non-image file stays a card, and shows the system name", async ({
  page,
}) => {
  const body = `a document ${Date.now()}`;
  await sendWith(page, body, [
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
  ]);

  // No image grid for this message, and a download card instead.
  const bubble = bubbleOf(page, body);
  await expect(bubble.locator("[data-image-grid]")).toHaveCount(0);
  await expect(bubble.getByText(new RegExp(`T${TICKET}-\\d+-notes\\.txt`))).toBeVisible({
    timeout: 15_000,
  });
});

test("the file the server refuses never appears as an image", async ({ page }) => {
  const body = `rejected ${Date.now()}`;
  // A Windows executable calling itself a PNG. The upload is refused by the
  // magic-byte check, so the message posts and the bubble simply has no image —
  // never a broken one.
  await sendWith(page, body, [
    {
      name: "screenshot.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]),
    },
  ]);

  const bubble = bubbleOf(page, body);
  await expect(bubble.locator("img")).toHaveCount(0);
  await expect(bubble.locator("[data-image-grid]")).toHaveCount(0);
});

test("the sidebar shows the system name and the original on hover", async ({
  page,
}) => {
  const body = `sidebar name ${Date.now()}`;
  await sendWith(page, body, [png("ภาพหน้าจอ.png")]);

  // The Thai name survives the multipart round trip and lands in the slug.
  const named = page.getByText(new RegExp(`T${TICKET}-\\d+-ภาพหน้าจอ\\.png`)).first();
  await expect(named).toBeVisible({ timeout: 15_000 });
  await expect(named).toHaveAttribute("title", /ภาพหน้าจอ\.png/);
});
