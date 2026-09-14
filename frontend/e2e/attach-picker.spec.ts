import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Attaching a file, from a real browser and at a phone's width.
 *
 * The bug this guards is not visible in jsdom and is not visible on a desktop
 * either: a `display: none` file input ignores a programmatic `.click()` on iOS
 * Safari, so the picker never opened and the camera was the only way in.
 * Playwright cannot run WebKit-on-iOS here, so what these cases prove is the
 * thing that made the bug possible — the control is a real, laid-out input
 * inside a label, and it accepts a file through the ordinary DOM path.
 */

const AGENT = "dana.reyes@acme.com";
const PHONE = { width: 375, height: 720 };

/** A tiny but genuine PNG, so the type sniffing on the server would pass it. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("the create form's picker", () => {
  test("is a laid-out input inside a label, not a display:none one", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const input = page.locator('input[type="file"]').first();
    await expect(input).toHaveAttribute("multiple", "");

    // The properties that make a picker openable on a phone. `display: none`
    // here is the whole bug; a label ancestor is what lets the browser open the
    // picker with no JavaScript in the path.
    const shape = await input.evaluate((el) => ({
      display: getComputedStyle(el).display,
      inLabel: el.closest("label") != null,
    }));
    expect(shape.display).not.toBe("none");
    expect(shape.inLabel).toBe(true);
  });

  test("takes a file and lists it with a thumbnail, removable before sending", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "screenshot.png", mimeType: "image/png", buffer: PNG });

    await expect(page.getByText("screenshot.png")).toBeVisible();
    // An image gets its own picture, not a generic document icon — a phone names
    // its photos IMG_4417, so the filename alone says nothing.
    const thumb = page.locator('img[src^="blob:"]').first();
    await expect(thumb).toBeVisible();

    await page.getByRole("button", { name: /screenshot\.png/ }).click();
    await expect(page.getByText("screenshot.png")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  // `isMobile` is what makes Chromium report `(pointer: coarse)`; `hasTouch`
  // alone does not. The camera button is keyed on the pointer type rather than
  // on a width, because a camera is not a screen size — same rule the rest of
  // the app uses for touch affordances, see touch-affordances.spec.ts.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("really is a coarse pointer in this context", async ({ page }) => {
    await page.goto("/login");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
  });

  test("offers the camera as well as the picker, and neither overflows", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Two inputs now: the file picker, and the camera shortcut that only exists
    // where the pointer is coarse.
    const inputs = page.locator('input[type="file"]');
    await expect(inputs).toHaveCount(2);
    const camera = inputs.nth(1);
    await expect(camera).toHaveAttribute("capture", "environment");

    // The camera control is the one that is width-dependent, so it is the one
    // worth asserting is actually on screen here.
    await expect(page.getByText("Take a photo")).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("a thumbnail stays small instead of stretching the row", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "tall.png", mimeType: "image/png", buffer: PNG });

    const thumb = page.locator('img[src^="blob:"]').first();
    await expect(thumb).toBeVisible();
    const box = await thumb.boundingBox();
    // A fixed square, whatever the photo's own shape — a portrait picture from a
    // phone is what would otherwise make this row as tall as the dialog.
    expect(box!.height).toBeLessThanOrEqual(40);
    expect(box!.width).toBeLessThanOrEqual(40);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
