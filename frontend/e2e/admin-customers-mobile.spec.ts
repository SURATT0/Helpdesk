import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * The customers screen on a phone.
 *
 * `admin-customers.spec.ts` covers what the screen DOES; this covers whether it
 * can be operated at 375px, which is a different question and the one a desktop
 * browser never asks. Every case here runs with a coarse pointer as well as a
 * narrow viewport — `isMobile` is what makes Chromium report
 * `(pointer: coarse)`, and the app's touch rules key on the pointer rather than
 * on a width, because a phone in landscape is wider than `sm`.
 */

const SUPER_ADMIN = "sam.rivera@acme.com";
const PHONE = { width: 375, height: 720 };

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/** Nothing may push the document wider than the screen. */
async function noSidewaysScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, where).toBeLessThanOrEqual(clientWidth + 1);
}

/** A modal must fit the screen and keep its own scrolling inside itself. */
async function fitsTheScreen(page: Page, where: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box, where).not.toBeNull();
  // Inside the viewport on both axes, and capped at 80vh so it can never grow
  // past the screen however long its contents get.
  expect(box!.width, `${where} width`).toBeLessThanOrEqual(PHONE.width);
  expect(box!.height, `${where} height`).toBeLessThanOrEqual(PHONE.height * 0.8 + 1);
  expect(box!.x, `${where} x`).toBeGreaterThanOrEqual(0);
  await noSidewaysScroll(page, where);

  // The page behind is locked, so dragging near the edge does not scroll the
  // customer list under the modal.
  expect(
    await page.evaluate(() => document.body.style.overflow),
    `${where} body lock`,
  ).toBe("hidden");

  return dialog;
}

test("the customer form fits, locks the page, and closes on a backdrop tap", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/admin/customers");

  await page.getByRole("button", { name: "Add customer" }).click();
  const dialog = await fitsTheScreen(page, "customer form");

  // The field is inside the panel rather than pushing through its side.
  const field = await dialog.getByLabel("Company name").boundingBox();
  const box = await dialog.boundingBox();
  expect(field!.x + field!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);

  // Tap the overlay, away from the panel.
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("the project form fits, with its description box inside the panel", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: /Globex Inc/ }).click();
  await expect(page.getByRole("heading", { name: "Globex Inc" })).toBeVisible();

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = await fitsTheScreen(page, "project form");

  // The taller of the two forms, and the one most likely to overflow: a textarea
  // with padding inside a panel with padding.
  const area = await dialog.getByLabel("What it is for").boundingBox();
  const box = await dialog.boundingBox();
  expect(area!.x + area!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);

  // The save button is reachable without the panel itself scrolling — the body
  // scrolls, the footer stays put.
  await expect(dialog.getByRole("button", { name: "Add project" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("a long description does not push the save button off the screen", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: /Globex Inc/ }).click();
  await page.getByRole("button", { name: "Add project" }).click();

  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("What it is for")
    .fill(Array.from({ length: 60 }, (_, i) => `Line ${i} of a long scope.`).join("\n"));

  // Still capped, and the footer is still on screen. This is what the fixed
  // head/foot with a scrolling middle is for.
  await fitsTheScreen(page, "project form with a long description");
  const save = dialog.getByRole("button", { name: "Add project" });
  await expect(save).toBeVisible();
  const box = await save.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
});

test("every control on both levels is a real target under a finger", async ({
  page,
}) => {
  await loginAs(page, SUPER_ADMIN);

  // 44px is the size a finger needs. Checked on the two levels separately,
  // because they are two different screens rather than two columns.
  const tooSmall = async (where: string) => {
    const boxes = await page
      .locator("main a, main button")
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: (el.textContent ?? "").trim().slice(0, 40) ||
                el.getAttribute("aria-label") ||
                "(unnamed)",
              h: Math.round(r.height),
              w: Math.round(r.width),
            };
          })
          .filter((b) => b.h > 0 && (b.h < 44 || b.w < 44)),
      );
    expect(boxes, where).toEqual([]);
  };

  await page.goto("/admin/customers");
  await expect(page.getByPlaceholder("Search customers")).toBeVisible();
  await tooSmall("customer list");

  await page.getByRole("link", { name: /Acme Corp/ }).click();
  await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
  await tooSmall("customer detail");
});
