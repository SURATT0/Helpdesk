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

/**
 * Icon-only controls have to be big enough for a fingertip. 44px is Apple's
 * floor; the two ticket checkboxes are deliberately 40 wide because their grid
 * column is 40 and a wider box stole taps from the sort button beside it, so the
 * assertion is 40x44 rather than 44x44 and says why.
 *
 * The overlap half matters as much as the size half: enlarging a target until it
 * covers its neighbour trades one unusable control for two.
 */
const MIN_W = 40;
const MIN_H = 44;

for (const [name, path] of [
  ["login", "/login"],
  ["dashboard", "/dashboard"],
  ["tickets", "/tickets"],
  ["projects", "/projects"],
] as const) {
  test(`${name}: icon controls are finger-sized and do not overlap each other`, async ({
    page,
  }) => {
    if (path === "/login") await page.goto(path);
    else {
      await loginAs(page, SUPER_ADMIN);
      await page.goto(path);
    }
    await expect(page.locator("button").first()).toBeVisible();

    const bad = await page.evaluate(() => {
      const live = [
        ...document.querySelectorAll<HTMLElement>("button, a[href]"),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      });
      const boxes = live.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          w: r.width,
          h: r.height,
          x: r.left,
          y: r.top,
          r: r.right,
          b: r.bottom,
          label: (el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName).slice(0, 30),
          // Layers do not compete: an overlay swallows events aimed beneath it.
          layer: el.closest('[role="dialog"]') ? "dialog" : el.closest("aside") ? "drawer" : "page",
        };
      });
      // Icon-only == roughly square and small. Text buttons size to their label.
      const icons = boxes.filter((b) => Math.abs(b.w - b.h) <= 8 && b.w <= 56);
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], c = boxes[j];
          if (a.layer !== c.layer) continue;
          const inside = (p: typeof a, q: typeof a) =>
            p.x <= q.x && p.y <= q.y && p.r >= q.r && p.b >= q.b;
          if (inside(a, c) || inside(c, a)) continue;
          const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
          const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
          if (ox > 1 && oy > 1) overlaps.push(`${a.label} over ${c.label}`);
        }
      return {
        small: icons
          .filter((b) => b.w < 40 || b.h < 44)
          .map((b) => `${b.label} is ${Math.round(b.w)}x${Math.round(b.h)}`),
        overlaps,
      };
    });

    expect(bad.small, "controls too small to tap").toEqual([]);
    expect(bad.overlaps, "controls stealing taps from each other").toEqual([]);
  });
}
