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
 * The SLA box moved up to the breadcrumb, beside the number whose clock it is
 * describing — it used to sit at the far end of the title row, which on a phone
 * put it a row and a half away from the thing it refers to.
 */
test("the SLA box sits with the ticket number, at every width", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets/1042");

  for (const width of [375, 390, 768, DESKTOP.width]) {
    await page.setViewportSize({ width, height: 800 });
    const number = page.locator("header").first().getByText(/^#\d+$/).first();
    const sla = page.locator('[aria-label^="SLA: "]').first();
    const [n, s] = await Promise.all([number.boundingBox(), sla.boundingBox()]);
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
