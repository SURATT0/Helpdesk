import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * What every modal owes the user, regardless of which one it is.
 *
 * Before these were consolidated onto a single `Dialog`, the six modals
 * disagreed: three of them — the queue handover and both problem dialogs —
 * could not be dismissed with Escape or by clicking the backdrop, so the close
 * button was the only way out. None of the six stopped the page behind from
 * scrolling, which on a phone means a drag near the edge scrolls the list under
 * the modal. And three put `role="dialog"` on the full-screen overlay rather
 * than the panel, so the element a screen reader announces as the dialog was the
 * entire viewport.
 *
 * Asserted per modal rather than once, because the failure mode being guarded is
 * exactly one modal drifting away from the others.
 */

const SUPER_ADMIN = "morgan.lee@acme.com";
const dialog = (page: Page) => page.locator('[role="dialog"]');

/** Each entry navigates somewhere, then opens one modal from there. */
const MODALS: Array<{
  name: string;
  open: (page: Page) => Promise<void>;
}> = [
  {
    name: "create ticket",
    open: async (page) => {
      await page.goto("/tickets");
      await page.getByRole("button", { name: /New ticket/i }).click();
    },
  },
  {
    name: "import tickets",
    open: async (page) => {
      await page.goto("/tickets");
      await page.getByRole("button", { name: /^Import/i }).click();
    },
  },
  {
    name: "hand over queue",
    open: async (page) => {
      await page.goto("/users");
      await page.getByRole("button", { name: /Hand over/i }).first().click();
    },
  },
];

for (const { name, open } of MODALS) {
  test(`${name}: closes on Escape, locks the page behind, and scopes its role to the panel`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await loginAs(page, SUPER_ADMIN);
    await open(page);
    await expect(dialog(page)).toBeVisible();

    // The dialog is the card, not the whole screen: a viewport-wide role="dialog"
    // tells a screen reader the entire page is the dialog.
    const panelWidth = await dialog(page).evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    expect(panelWidth).toBeLessThan(375);

    // The page behind must not scroll while a modal is up.
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).overflow),
      )
      .toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    // …and the lock must come back off, or the page is stuck for good.
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).overflow),
      )
      .not.toBe("hidden");
  });

  test(`${name}: closes when the backdrop is clicked`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await loginAs(page, SUPER_ADMIN);
    await open(page);
    await expect(dialog(page)).toBeVisible();

    // The very corner of the overlay — far from any panel at any size.
    await page.mouse.click(4, 4);
    await expect(dialog(page)).toHaveCount(0);
  });
}

test("a modal on a phone is wider than the padding the design uses on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/tickets");
  await page.getByRole("button", { name: /New ticket/i }).click();
  await expect(dialog(page)).toBeVisible();

  // The overlay used a flat `p-[44px]`, which left 287px of a 375px screen for
  // the panel and 239px for the form inside it. The mobile floor is `p-3`.
  const width = await dialog(page).evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  expect(width).toBeGreaterThan(330);

  // Both fields of the priority/category row must be full width on a phone —
  // side by side they were about 110px each.
  const row = page.locator('[role="dialog"] .grid').first();
  const columns = await row.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(columns).toBe(1);
});
