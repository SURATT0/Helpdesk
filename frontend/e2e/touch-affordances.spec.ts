import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Things that only exist on hover, checked on a device that has no hover.
 *
 * `isMobile` is what makes Chromium report `(pointer: coarse)`; `hasTouch`
 * alone does not, and the rules under test are keyed on the pointer type
 * rather than on a width breakpoint — a phone in landscape is wider than `sm`.
 */
test.use({ viewport: { width: 375, height: 720 }, hasTouch: true, isMobile: true });

const SUPER_ADMIN = "morgan.lee@acme.com";

test("the pointer really is coarse in this context", async ({ page }) => {
  await page.goto("/login");
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(
    true,
  );
});

test("the ticket table's sort affordance is visible without hovering", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/tickets");

  // The idle-state icon on a column that is not the current sort. It used to be
  // `opacity-0` until hover, so on a touch screen nothing said these headers
  // sort at all — the button worked, but no one could tell.
  const idleIcon = page
    .locator('button.group:has(svg.lucide-chevrons-up-down) svg')
    .first();
  await expect(idleIcon).toBeAttached();
  await expect
    .poll(() => idleIcon.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
});

test("every text field clears the size that makes iOS zoom on focus", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);

  for (const path of ["/tickets", "/kb", "/history", "/settings"]) {
    await page.goto(path);
    const sizes = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "input:not([type=hidden]):not([type=file]):not([type=checkbox]), textarea, select",
        ),
      ].map((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
    for (const size of sizes) {
      // Below 16px, Safari scales the whole page in on focus and never back out.
      expect(size, `a field on ${path} renders at ${size}px`).toBeGreaterThanOrEqual(16);
    }
  }
});
