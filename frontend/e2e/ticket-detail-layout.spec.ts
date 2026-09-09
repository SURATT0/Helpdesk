import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * The ticket page's header spans the whole width, above both columns.
 *
 * It used to sit inside the thread column, so the title and the badge row were
 * squeezed into `1fr` while the properties rail stood empty beside them. These
 * assertions are geometric on purpose: the arrangement is the point, and it is
 * the kind of thing a later Tailwind edit undoes without any test noticing.
 */

const DESKTOP = { width: 1440, height: 900 };

test("the header spans both columns, and the rail starts beneath it", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto("/tickets/1042");

  const header = page.locator("header").first();
  const rail = page.getByText("Properties").first();
  const chat = page.getByTestId("chat-scroll");

  await expect(header).toBeVisible();
  await expect(chat).toBeVisible();

  const [h, c, r] = await Promise.all([
    header.boundingBox(),
    chat.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(h && c && r).toBeTruthy();

  // Wider than the thread column: the header reaches across the rail as well.
  expect(h!.width).toBeGreaterThan(c!.width + 100);
  // And the rail begins below it rather than alongside it.
  expect(r!.y).toBeGreaterThanOrEqual(h!.y + h!.height - 1);
  // The rail is still to the right of the conversation, not under it.
  expect(r!.x).toBeGreaterThan(c!.x + c!.width - 1);
});

test("the title and its badges share one row", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto("/tickets/1042");

  const title = page.getByRole("heading", { level: 1 });
  const status = page.locator("header").first().getByText(/^(New|In Progress|Pending|Closed)$/).first();

  const [t, st] = await Promise.all([title.boundingBox(), status.boundingBox()]);
  expect(t && st).toBeTruthy();

  // Same horizontal band — compared on centres, since the boxes have different
  // heights and a shared row does not mean shared edges.
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(centre(t!) - centre(st!))).toBeLessThan(14);
});

/**
 * Where the SLA box sits, which is now two different answers.
 *
 * On a PHONE it sits in the breadcrumb beside the number whose clock it
 * describes — at the far end of the title row it was a row and a half away from
 * the thing it refers to.
 *
 * On a DESKTOP it stays where it always was, at the right of the title row.
 * That is not a preference, it is the constraint the mobile work was given:
 * change the phone, leave the desktop alone.
 *
 * Exactly one is on screen at a time. Two copies exist in the markup — the
 * positions live in different flex parents, so no amount of `order` moves one
 * element between them — and this is what stops both ever showing at once.
 */
test("the SLA box sits with the ticket number on a phone", async ({ page }) => {
  await login(page);
  await page.goto("/tickets/1042");

  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const number = page.locator("header").first().getByText(/^#\d+$/).first();
    const sla = page
      .locator("header")
      .first()
      .locator('[aria-label^="SLA: "]:visible');
    await expect(sla, `two SLA boxes visible at ${width}px`).toHaveCount(1);

    const [n, s] = await Promise.all([
      number.boundingBox(),
      sla.first().boundingBox(),
    ]);
    expect(n && s, `boxes missing at ${width}px`).toBeTruthy();

    const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
    expect(
      Math.abs(centre(n!) - centre(s!)),
      `SLA box left the number's row at ${width}px`,
    ).toBeLessThan(14);
    // Beside it, not before it.
    expect(s!.x).toBeGreaterThan(n!.x);
  }
});

test("the SLA box stays on the title row from md up", async ({ page }) => {
  await login(page);
  await page.goto("/tickets/1042");

  for (const width of [768, DESKTOP.width]) {
    await page.setViewportSize({ width, height: 800 });
    const title = page.getByRole("heading", { level: 1 });
    const number = page.locator("header").first().getByText(/^#\d+$/).first();
    const sla = page
      .locator("header")
      .first()
      .locator('[aria-label^="SLA: "]:visible');
    await expect(sla, `two SLA boxes visible at ${width}px`).toHaveCount(1);

    const [t, n, s] = await Promise.all([
      title.boundingBox(),
      number.boundingBox(),
      sla.first().boundingBox(),
    ]);
    expect(t && n && s, `boxes missing at ${width}px`).toBeTruthy();

    const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
    // Below the breadcrumb, i.e. in the title block rather than beside the
    // number. Not "level with the title": the title row wraps at 768px and the
    // box drops to a line of its own, which is what the desktop always did.
    expect(
      centre(s!),
      `SLA box is still on the breadcrumb row at ${width}px`,
    ).toBeGreaterThan(centre(n!) + 10);
    // And pushed to the right by ml-auto, as it always was: its right edge sits
    // against the header's padding rather than following the text.
    expect(
      s!.x + s!.width,
      `SLA box is not right-aligned at ${width}px`,
    ).toBeGreaterThan(t!.x + t!.width);
  }
});

test("the conversation scrolls without taking the header with it", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto("/tickets/1042");

  const header = page.locator("header").first();
  const before = (await header.boundingBox())!.y;

  const chat = page.getByTestId("chat-scroll");
  await chat.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

  // A pinned header is the reason the thread has its own scroller: moving the
  // header into the page shell must not have handed scrolling to the document.
  expect((await header.boundingBox())!.y).toBe(before);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
