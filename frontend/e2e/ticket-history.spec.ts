import { test, expect, type Page } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The closed-ticket history log.
 *
 * The seed's closure dates are derived from "now", so counts shift with the clock
 * and asserting them would make this suite flaky. These tests anchor on the two
 * things the seed guarantees at any run time instead:
 *
 *   - the PREVIOUS calendar year always holds #1019 (pinned via the seed's
 *     `prevYear` closure, precisely so a year-step lands somewhere populated);
 *   - Marcus Chen is deliberately absent from the closed history, so a requester
 *     logging in as him sees a genuinely empty log in every period.
 *
 * Everything else asserted here is structural or navigational, and therefore
 * date-independent. Nothing here mutates data — the suite runs fully parallel
 * against one shared stack. Assertions are also grouped rather than split one per
 * test: each `login()` is a real auth round trip, and the login endpoint is
 * rate-limited per IP.
 */

const earlier = (page: Page) =>
  page.getByRole("button", { name: "Earlier period" });
const later = (page: Page) =>
  page.getByRole("button", { name: "Later period" });
const granularity = (page: Page, name: "Week" | "Month" | "Year") =>
  page.getByRole("button", { name, exact: true });

/**
 * The window currently being viewed. Matched by test id because the text is plain
 * and its shape varies by granularity and locale — a text pattern loose enough to
 * cover "August 2026", "Jul 27 – Aug 2, 2026" and "2026" also matches the ticket
 * id column, which ends in four digits too.
 */
const periodLabel = (page: Page) => page.getByTestId("history-period");

test("the sidebar links to the log, which opens on the current month", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Ticket history" }).click();
  await expect(page).toHaveURL(/\/history/);

  await expect(
    page.getByText("Closed tickets, kept permanently"),
  ).toBeVisible();
  await expect(page.getByText(/closed in this period$/)).toBeVisible();

  // Columns unique to this page (so no strict-mode clash with status badges).
  await expect(page.getByText("Handled by")).toBeVisible();
  await expect(page.getByText("Open for")).toBeVisible();
  // Priority and requester are filters now, not columns.
  await expect(page.getByRole("columnheader", { name: "Priority" })).toBeHidden();
  await expect(page.getByLabel("Priority")).toBeVisible(); // the filter
  await expect(page.getByPlaceholder("Search subject or requester…")).toBeVisible();

  // Month is the default granularity: the label names a month and a year.
  await expect(periodLabel(page)).toHaveText(/[A-Za-z]{3,}\s+\d{4}/);
});

test("steps between periods but never past the current one", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  // The current period is the newest that can hold anything.
  await expect(later(page)).toBeDisabled();
  await expect(earlier(page)).toBeEnabled();

  const current = await periodLabel(page).innerText();
  await earlier(page).click();

  // Stepping back changes the window and unlocks forward navigation.
  await expect(periodLabel(page)).not.toHaveText(current);
  await expect(later(page)).toBeEnabled();

  // Stepping forward again returns to where we started.
  await later(page).click();
  await expect(periodLabel(page)).toHaveText(current);
  await expect(later(page)).toBeDisabled();
});

test("each granularity labels its window in its own shape", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  await granularity(page, "Year").click();
  // A year is just the four digits.
  await expect(periodLabel(page)).toHaveText(/^\d{4}$/);

  await granularity(page, "Week").click();
  // A week is a range, so it carries a dash between two dates — and it must NAME
  // the month it starts in. Dropping it there produced "3 – Aug 9, 2026", which
  // reads as a range starting on a day with no month at all.
  await expect(periodLabel(page)).toHaveText(
    /^[A-Za-z]{3,}\s+\d{1,2}\s+–\s+([A-Za-z]{3,}\s+)?\d{1,2},\s+\d{4}$/,
  );

  await granularity(page, "Month").click();
  await expect(periodLabel(page)).toHaveText(/[A-Za-z]{3,}\s+\d{4}/);

  // Changing granularity returns to the current period, so forward locks again
  // even though we had stepped nowhere.
  await expect(later(page)).toBeDisabled();
});

test("last year's closures are listed, scoped, and open on click", async ({
  page,
}) => {
  await login(page); // Dana Reyes — agent at Acme
  await page.goto("/history");

  await granularity(page, "Year").click();
  // Wait for the year-shaped label before reading it: until the refetch lands the
  // label still holds the previous (month-shaped) window, which parses to NaN.
  await expect(periodLabel(page)).toHaveText(/^\d{4}$/);
  const thisYear = Number(await periodLabel(page).innerText());

  await earlier(page).click();
  await expect(periodLabel(page)).toHaveText(String(thisYear - 1));

  // Pinned to the previous year by the seed, so this is present whatever month
  // the stack was seeded in.
  const row = page.getByRole("link", { name: /Annual access review/ });
  await expect(row).toBeVisible();
  // Open for 96 seeded hours, rendered as whole days.
  await expect(page.getByText("4d", { exact: true })).toBeVisible();

  // Last year also holds a Globex closure. Row scope hides it from an Acme agent
  // in the history log exactly as in the live ticket list.
  await expect(page.getByText(/Mailbox migration wave 2/)).toBeHidden();

  await row.click();
  await expect(page).toHaveURL(/\/tickets\/1019/);
});

test("the period picker jumps straight to a past year", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  await granularity(page, "Year").click();
  await expect(periodLabel(page)).toHaveText(/^\d{4}/);

  // The label is the picker. Opening it lists only the years that hold closures,
  // so every entry leads somewhere — and it doubles as "which years do we have?".
  await periodLabel(page).click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();

  // The list is fetched when opened, so wait for the first entry to render before
  // counting — otherwise this races the request and counts zero.
  const options = list.getByRole("option");
  await expect(options.first()).toBeVisible();
  // The seed spans several calendar years, which is the point of the picker.
  expect(await options.count()).toBeGreaterThan(1);

  // Jump to the OLDEST offered year — one click, however far back it is. Stepping
  // there with the arrow would take as many clicks as there are years.
  const oldest = options.last();
  const oldestYear = (await oldest.innerText()).trim().split(/\s+/)[0];
  await oldest.click();

  await expect(list).toBeHidden();
  await expect(periodLabel(page)).toHaveText(new RegExp(`^${oldestYear}`));
  // Landing on a populated period means rows, never the empty state.
  await expect(page.getByText("No tickets were closed in this period")).toBeHidden();
});

test("the search narrows the period, and rows are grouped by closing day", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");
  await granularity(page, "Year").click();
  // Wait for the year-shaped label before counting: until the refetch lands the
  // rows still belong to the previous (month) window.
  await expect(periodLabel(page)).toHaveText(/^\d{4}$/);

  const rows = page.getByRole("link", { name: /#\d+/ });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);

  // Rows carry no date of their own any more: the day is a heading above each
  // group, which is what let the date column go.
  await expect(
    page.getByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s/).first(),
  ).toBeVisible();

  // Searching by subject narrows the same period rather than leaving it.
  const label = await periodLabel(page).innerText();
  await page.getByPlaceholder("Search subject or requester…").fill("access");
  await expect(rows).not.toHaveCount(before);
  await expect(periodLabel(page)).toHaveText(label);
  for (const name of await rows.allInnerTexts()) {
    expect(name.toLowerCase()).toContain("access");
  }
});

test("a requester with no closed tickets sees the empty state", async ({
  page,
}) => {
  // Marcus is kept out of the seeded closure history on purpose, so this is empty
  // by construction rather than by coincidence of dates.
  await loginAs(page, "marcus.chen@acme.com");
  await page.goto("/history");

  await expect(
    page.getByText("No tickets were closed in this period"),
  ).toBeVisible();
  await expect(page.getByText("0 closed in this period")).toBeVisible();
});

test("the log is translated", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  await page.getByRole("button", { name: "ไทย" }).click();

  await expect(page.getByText("ประวัติตั๋วงาน").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "รายสัปดาห์" })).toBeVisible();
  await expect(page.getByRole("button", { name: "รายเดือน" })).toBeVisible();
  await expect(page.getByRole("button", { name: "รายปี" })).toBeVisible();
  // exact: the column header is "ผู้รับผิดชอบ", but an unassigned row reads
  // "ไม่มีผู้รับผิดชอบ" and contains it — a substring match resolves to both and
  // trips strict mode as soon as any closed ticket in view has no assignee.
  await expect(page.getByText("ผู้รับผิดชอบ", { exact: true })).toBeVisible();
  await expect(page.getByText(/ใบ ในช่วงนี้$/)).toBeVisible();
});
