import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Leaving the new-ticket form without losing what is in it.
 *
 * The rules themselves are pinned in
 * src/features/tickets/components/create-ticket-modal.test.tsx, which can drive
 * all four exits far faster than a browser can. What only a real browser can
 * answer is the part jsdom has no opinion about: whether the confirmation
 * actually lands ON TOP of the modal rather than behind it, and whether the
 * page underneath is still frozen while it is up.
 *
 * A requester, because raising a ticket is their screen.
 */

const REQUESTER = "marcus.chen@acme.com";

test.beforeEach(async ({ page }) => {
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByRole("dialog", { name: "New ticket" })).toBeVisible();
});

test("a click outside keeps the draft and asks first", async ({ page }) => {
  await page.getByLabel("Subject").fill("printer on fire");

  // The overlay, well clear of the panel — the click that used to bin the draft.
  await page.mouse.click(8, 8);

  await expect(page.getByText("Throw this away?")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New ticket" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("printer on fire");
});

test("Escape keeps the draft and asks first", async ({ page }) => {
  await page.getByLabel("Subject").fill("printer on fire");

  await page.keyboard.press("Escape");

  await expect(page.getByText("Throw this away?")).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue("printer on fire");
});

test("the close button asks too, and keeps working", async ({ page }) => {
  // Scoped to the dialog. An unscoped search for a close control is how a
  // selector ends up on the sign-out icon in the sidebar instead.
  const modal = page.getByRole("dialog", { name: "New ticket" });
  await page.getByLabel("Subject").fill("printer on fire");

  await modal.getByRole("button", { name: "Close" }).click();

  await expect(page.getByText("Throw this away?")).toBeVisible();
  await expect(modal).toBeVisible();

  // Still the way out once the draft is gone: keep, clear the field, close.
  await page.getByRole("button", { name: "Keep writing" }).click();
  await page.getByLabel("Subject").fill("");
  await modal.getByRole("button", { name: "Close" }).click();
  await expect(modal).toHaveCount(0);
});

test("Cancel asks too", async ({ page }) => {
  await page.getByLabel("Subject").fill("printer on fire");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByText("Throw this away?")).toBeVisible();
});

test("an untouched form still closes on a click outside", async ({ page }) => {
  await page.mouse.click(8, 8);

  await expect(page.getByRole("dialog", { name: "New ticket" })).toHaveCount(0);
  await expect(page.getByText("Throw this away?")).toHaveCount(0);
});

test("discarding empties the form, attachment included", async ({ page }) => {
  await page.getByLabel("Subject").fill("printer on fire");
  await page.setInputFiles('input[type="file"]', {
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: Buffer.from("not really a png"),
  });
  await expect(page.getByText("screenshot.png")).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog", { name: "New ticket" })).toHaveCount(0);

  // Reopening must be a blank sheet — the file especially, since it is the one
  // piece of the draft that is not a text field and would survive a reset that
  // only cleared the obvious ones.
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("");
  await expect(page.getByText("screenshot.png")).toHaveCount(0);
});

test("on a phone the question sits above the modal, and the page stays frozen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.getByLabel("Subject").fill("printer on fire");
  await page.keyboard.press("Escape");

  const confirm = page.getByRole("dialog", { name: "Throw this away?" });
  await expect(confirm).toBeVisible();

  // Above, by stacking rather than by luck: its overlay must outrank the one
  // the modal is sitting in, which is what `z-[60]` over `z-50` buys.
  const zOf = (name: string) =>
    page
      .getByRole("dialog", { name })
      .evaluate((el) =>
        Number(getComputedStyle(el.parentElement as HTMLElement).zIndex),
      );
  expect(await zOf("Throw this away?")).toBeGreaterThan(await zOf("New ticket"));

  // Both dialogs lock the body; the inner one must not restore the scroll when
  // it is the outer one still holding the page.
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");

  // Keeping writing returns to the form with the page still frozen.
  await page.getByRole("button", { name: "Keep writing" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByLabel("Subject")).toHaveValue("printer on fire");
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
});
