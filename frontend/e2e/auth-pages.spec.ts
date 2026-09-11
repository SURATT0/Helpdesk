import { expect, test, type Page } from "@playwright/test";

/**
 * The signed-out screens at a phone's width.
 *
 * These four pages are the only ones a person can reach before they have an
 * account, so they are the ones most likely to be opened on a phone — a
 * confirmation link and a reset link both arrive by mail, and mail is read on a
 * phone. A layout that overflows here is not a cosmetic problem: it is the first
 * thing a new user sees of the desk.
 *
 * Deliberately hermetic — none of these cases signs in, submits a form, or
 * needs the API. Every page renders its initial state from the URL alone
 * (/reset-password and /verify-email only POST their token on submit or on
 * mount-with-a-token, and the cases below give them neither a valid one nor
 * expect success), so this spec is fast and cannot go red because of seed drift.
 */

const PHONE = { width: 375, height: 720 };

/**
 * Does anything stick out sideways?
 *
 * Measured on the document rather than on a chosen element, because the failure
 * this catches is usually caused by something nobody thought to measure — a
 * button with a long label, an unbroken URL in a notice, a fixed-width field.
 * One pixel of tolerance for sub-pixel rounding at fractional scale factors.
 */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `page scrolls horizontally at ${PHONE.width}px (${scrollWidth} > ${clientWidth})`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

const PAGES = [
  { path: "/login", heading: "Welcome back" },
  { path: "/register", heading: "Create an account" },
  { path: "/forgot-password", heading: "Reset your password" },
  // With a token, so the form renders rather than the "missing code" state.
  // It is not a real one — nothing is submitted here.
  { path: "/reset-password?token=not-a-real-token", heading: "Choose a new password" },
  // WITHOUT a token, deliberately: with one, the page posts it on mount and
  // would need the API. The no-token state is the one that renders standalone.
  { path: "/verify-email", heading: "This link cannot be used" },
];

test.describe("signed-out pages fit a phone", () => {
  test.use({ viewport: PHONE });

  for (const { path, heading } of PAGES) {
    test(`${path} renders and does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("the form's controls are all full width, so none is a narrow target", async ({
    page,
  }) => {
    await page.goto("/register");
    const card = await page
      .getByRole("button", { name: "Create account" })
      .boundingBox();
    expect(card).not.toBeNull();

    // Width, not height. The app's field height is a design-system decision
    // taken once in `components/ui/input` and shared by every form in Deskly —
    // asserting a number here would be this spec quietly setting policy for
    // pages it does not own. What IS this form's business is that nothing in it
    // renders as a narrow control: each field spans the card, so the tap area is
    // the full width of the screen minus the padding.
    for (const field of [
      page.getByLabel("Full name"),
      page.getByLabel("Work email"),
      page.getByLabel("Password", { exact: true }),
      page.getByLabel("Confirm password"),
    ]) {
      const box = await field.boundingBox();
      expect(box, "field is not rendered").not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(card!.width - 1);
    }
  });
});

/**
 * The same form as a real touch device sees it.
 *
 * `TOUCH_TARGET` in components/ui/touch is keyed on `pointer: coarse`, NOT on a
 * width breakpoint — deliberately, per the note in that file: the target size
 * depends on what is doing the pointing, and a phone in landscape is wider than
 * `sm`. A narrow viewport in desktop Chromium therefore does NOT trigger it, so
 * a spec that only shrank the window would measure the desktop sizes and quietly
 * prove nothing about a phone. This project emulates the device instead.
 */
test.describe("the password reveal is a real target under a finger", () => {
  // The emulation options only, NOT a `devices[...]` entry: those carry
  // `defaultBrowserType`, which Playwright refuses inside a describe because it
  // would force a new worker. `isMobile` is what makes Chromium report a coarse
  // pointer — `hasTouch` and a narrow viewport on their own do not.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("grows to 44px where the pointer is coarse", async ({ page }) => {
    await page.goto("/register");
    // Two of them on this form — one per password field, each with its own
    // state, since a single shared toggle showing both at once would defeat the
    // point of asking twice.
    const toggles = page.getByRole("button", { name: "Show password" });
    await expect(toggles).toHaveCount(2);

    for (let i = 0; i < 2; i++) {
      const box = await toggles.nth(i).boundingBox();
      expect(box, "reveal button is not rendered").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("the signed-out pages link to each other", () => {
  test.use({ viewport: PHONE });

  test("a person with no account can reach sign-up from sign-in and back", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign up" }).click();
    await expect(page).toHaveURL(/\/register/);

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a person who forgot their password can reach the reset form", async ({
    page,
  }) => {
    await page.goto("/login");
    // This used to be a disclosure that said "contact your administrator" —
    // there was nowhere to go. The regression it guards against is that link
    // reverting to a dead end.
    await page.getByRole("link", { name: "Forgot?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole("button", { name: "Send reset link" }),
    ).toBeVisible();
  });

  test("the sign-up form says approval is needed before it is submitted", async ({
    page,
  }) => {
    await page.goto("/register");
    // Somebody who signs up expecting to be let straight in, and is only told to
    // wait afterwards, has been misled by the form. The notice belongs on the
    // form itself.
    await expect(
      page.getByText(/administrator approves the account/i),
    ).toBeVisible();
  });
});
