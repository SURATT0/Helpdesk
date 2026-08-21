import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * The ticket list's facet menus, and the copy under an empty list.
 *
 * The menus were `absolute left-0` at every width: anchored to their chip's left
 * edge with no way back on screen. The bar wraps on a narrow viewport and the
 * chips march rightwards on a wide one, so the ones at the right-hand end opened
 * past the window — the SLA facet overhung by 43px at 375, Assignee by 16px at
 * 768 — and since nothing on the page scrolls sideways, the clipped part could not
 * be reached at all.
 */

const SUPER_ADMIN = "sam.rivera@acme.com";

/** The facet chips carry a "＋" while inactive; the table's sort buttons do not. */
const chipsOf = (page: Page) =>
  page.locator("button").filter({ hasText: /^＋/ });

for (const width of [375, 768, 1024, 1440] as const) {
  test(`every facet menu opens fully on screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/tickets");

    const chips = chipsOf(page);
    await expect(chips.first()).toBeVisible();
    const n = await chips.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const label = (await chips.nth(i).textContent())?.trim() ?? `#${i}`;
      await chips.nth(i).click();

      const panel = page.getByRole("dialog");
      await expect(panel).toBeVisible();
      const fits = await panel.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return b.left >= -1 && b.right <= document.documentElement.clientWidth + 1;
      });
      expect(fits, `${label} at ${width}px`).toBe(true);

      // Close by tapping away, and confirm it went — a panel left open would make
      // the next assertion measure the wrong element.
      await page.mouse.click(width - 5, 60);
      await expect(panel).toBeHidden();
    }
  });
}

test("below lg the panel is a sheet across the full width", async ({ page }) => {
  // Not merely "on screen": at 375 a 190px menu could fit and still be a menu.
  // The sheet is what makes the options finger-sized.
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/tickets");
  await chipsOf(page).first().click();

  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  const b = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: Math.round(r.width), vw: document.documentElement.clientWidth };
  });
  expect(b.width).toBe(b.vw);
});

test("an empty list says which kind of empty it is", async ({ page }) => {
  await loginAs(page, SUPER_ADMIN);
  await page.route("**/api/v1/tickets", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"data":[],"meta":{"total":0}}',
    }),
  );
  await page.goto("/tickets");

  // Nothing narrowed: there are simply no tickets. Sending the reader to look for
  // a filter to clear — which is what this said before — wastes their time.
  await expect(page.getByText("No tickets yet")).toBeVisible();
  await expect(page.getByText(/match your filters/)).toHaveCount(0);

  // Same empty response, but now it IS narrowed, by the search box rather than a
  // facet — the free-text query counts as a filter even though `activeCount`
  // only tracks the facets.
  await page.locator("input[placeholder]").first().fill("zzz-no-such-ticket");
  await expect(page.getByText(/match your filters/)).toBeVisible();
  await expect(page.getByText("No tickets yet")).toHaveCount(0);
});
