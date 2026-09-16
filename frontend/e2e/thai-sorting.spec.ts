import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Thai sorts in dictionary order, and sorts the SAME way everywhere.
 *
 * The ordering itself is pinned by unit tests on both sides — `lib/collation` in
 * the browser, `collation.integration.test.ts` through Prisma. What only a real
 * page can show is the third requirement: that the order on first paint survives
 * a re-render and a filter, because it used to come from two different places.
 * The pickers were ordered by the database (byte order) and the ticket table by
 * `localeCompare` in the browser (ICU, browser locale), so the same names could
 * be in two different orders on one screen and change when anything re-rendered.
 */

const CATEGORY_PICKER_MIN = 3;

/** Open the create-ticket dialog and read its category dropdown, in order. */
async function categoryOptions(page: Page): Promise<string[]> {
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByLabel("Subject")).toBeVisible();
  const select = page.getByLabel("Category");
  await expect(select).toBeVisible();
  const options = await select.locator("option").allTextContents();
  await page.keyboard.press("Escape");
  return options.map((o) => o.trim()).filter(Boolean);
}

test("the category picker puts Other last, wherever it would otherwise sort", async ({
  page,
}) => {
  await login(page);
  const options = await categoryOptions(page);
  expect(options.length).toBeGreaterThanOrEqual(CATEGORY_PICKER_MIN);

  // "Other" is the answer for a ticket none of the rest fit, so it belongs at
  // the bottom regardless of how its name sorts. Keyed on the code in the app;
  // here the rendered label is all a test can see.
  const other = options.findIndex((o) => /^(Other|อื่น)/i.test(o));
  expect(other, "no Other option on the picker").toBeGreaterThan(-1);
  expect(other).toBe(options.length - 1);
});

test("the picker's order does not change when the dialog is reopened", async ({
  page,
}) => {
  await login(page);
  const first = await categoryOptions(page);
  const second = await categoryOptions(page);
  // Re-render must not reshuffle: the list is sorted in one place, not two.
  expect(second).toEqual(first);
});

test("a sorted ticket list comes back in the same order after a filter", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  // Row order, read off the id column — the one cell that identifies a row
  // without depending on how any other column renders.
  const rowOrder = () =>
    page
      .getByText(/^#\d+$/)
      .allTextContents()
      .then((ids) => ids.map((s) => s.trim()));

  const header = page.getByRole("button", { name: /^Category/ });
  await expect(header).toBeVisible();
  await header.click();

  const sorted = await rowOrder();
  test.skip(sorted.length < 2, "needs at least two tickets to compare an order");

  // Type into the search box and clear it. The rows are re-rendered from the
  // same data through the same comparator; if the sort were not a total order,
  // or if two different comparators were in play, this is where the list would
  // come back rearranged.
  const search = page.getByPlaceholder("Search subject, #id, requester…");
  await search.fill("zzz-no-such-ticket");
  await expect.poll(async () => (await rowOrder()).length).toBe(0);
  await search.fill("");
  await expect.poll(async () => (await rowOrder()).length).toBe(sorted.length);

  expect(await rowOrder()).toEqual(sorted);
});
