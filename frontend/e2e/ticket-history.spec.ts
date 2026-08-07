import { test, expect, type Page } from "@playwright/test";
import { login, loginAs } from "./helpers";

/**
 * The closed-ticket log.
 *
 * The seed's closure dates are derived from "now", so exact counts shift with the
 * clock and asserting them would make this suite flaky. These tests anchor on what
 * the seed guarantees at any run time instead:
 *
 *   - closures span several years, so the log always has multiple year sections
 *     and at least one long silence between them;
 *   - Marcus Chen is deliberately absent from the closed history, so logging in as
 *     him gives a genuinely empty log.
 *
 * Everything else asserted here is structural. Nothing mutates data — the suite
 * runs fully parallel against one shared stack. Assertions are grouped rather than
 * split one per test: each `login()` is a real auth round trip, and the login
 * endpoint is rate-limited per IP.
 */

const search = (page: Page) => page.getByPlaceholder(/^Search \d+ closed/);
const rows = (page: Page) => page.locator('a[href^="/tickets/"]');

test("the sidebar links to the log, which opens on the whole archive", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Ticket history" }).click();
  await expect(page).toHaveURL(/\/history/);

  // No period to choose first: the log is readable the moment it loads. The
  // search box quotes how much there is to search.
  await expect(search(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();

  // Sections are calendar months — a name, never a range for the reader to
  // decode. The only en dash allowed on the page is inside the range picker's
  // own label, and nothing has picked a range yet.
  await expect(page.getByText(/^[A-Z][a-z]+ \d{4}$/).first()).toBeVisible();
  await expect(page.getByText(/–/)).toHaveCount(0);

  // And the navigation that used to be here is gone — one system, not three.
  await expect(page.getByRole("button", { name: "Earlier period" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveCount(0);
});

test("a silence between sections is drawn, not left to be inferred", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  // The seed closes tickets years apart, so at least one gap is always long
  // enough to name. This is the failure the old grid had: two cells side by side
  // could be nine months apart with nothing saying so.
  const gaps = page.getByText(/^no tickets for \d+ months?$/);
  await expect(gaps.first()).toBeVisible();
  expect(await gaps.count()).toBeGreaterThan(0);
});

test("the year bar lists only years that hold something, and jumps to them", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  const bar = page.getByRole("group", { name: "Jump to a year" });
  await expect(bar).toBeVisible();
  const years = bar.getByRole("button");
  const labels = await years.allTextContents();
  expect(labels.length).toBeGreaterThan(1);
  // Descending, and each one a real year.
  const numbers = labels.map(Number);
  expect(numbers.every((n) => n > 2000 && n < 2100)).toBe(true);
  expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);

  // The newest year is where the reader starts.
  await expect(years.first()).toHaveAttribute("aria-current", "true");

  // Jumping to the oldest scrolls its section into view and follows the reader.
  const oldest = labels.at(-1)!;
  await years.last().click();
  await expect(page.getByText(new RegExp(`^[A-Z][a-z]+ ${oldest}$`))).toBeVisible();
  await expect(years.last()).toHaveAttribute("aria-current", "true");
});

test("search covers the whole archive without picking a period first", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  // A ticket from years back, found by typing — the old log could not do this at
  // all: it only ever queried the window on screen.
  await search(page).fill("Legacy VPN");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText("Legacy VPN client decommission")).toBeVisible();

  // By id, with the "#" the row itself displays.
  await search(page).fill("#1024");
  await expect(rows(page)).toHaveCount(1);

  // And by the requester's email.
  await search(page).fill("l.osei@acme.com");
  await expect(rows(page).first()).toBeVisible();
});

test("a search with no results names the term and offers a way out", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  await search(page).fill("zzz-no-such-ticket");
  await expect(
    page.getByText(/No closed ticket matches “zzz-no-such-ticket”/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(rows(page).first()).toBeVisible();
  await expect(search(page)).toHaveValue("");
});

test("one result renders as a single section with a count of 1", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  await search(page).fill("Legacy VPN");
  await expect(rows(page)).toHaveCount(1);
  // Exactly one section, holding exactly one ticket, and no gap to draw.
  await expect(page.getByText(/^[A-Z][a-z]+ \d{4}$/)).toHaveCount(1);
  await expect(page.getByText(/^no tickets for/)).toHaveCount(0);
});

test("priority collapses into one Filters button that reports its state", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  // Not a row of selects: one button, and it says when something is on.
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await expect(filters).toBeVisible();
  await filters.click();

  await page.getByRole("dialog", { name: "Filters" }).getByText("Critical").click();
  await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(filters).toBeVisible();
});

test("a row opens the ticket it names", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  await search(page).fill("Legacy VPN");
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  await expect(page).toHaveURL(/\/tickets\/1024$/);
});

test("a requester with no closed tickets is told so, without a button", async ({
  page,
}) => {
  // Marcus is kept out of the seeded closure history on purpose, so this is empty
  // by construction rather than by coincidence of dates.
  await loginAs(page, "marcus.chen@acme.com");
  await page.goto("/history");

  await expect(
    page.getByText("Tickets appear here once they are closed."),
  ).toBeVisible();
  // Nothing to clear and nowhere to go — an empty archive is a statement.
  await expect(page.getByRole("button", { name: /^Clear/ })).toHaveCount(0);
  await expect(page.getByText(/Nothing here yet/i)).toHaveCount(0);
});

test("the log is translated", async ({ page }) => {
  await login(page);
  await page.goto("/history");
  await page.getByRole("button", { name: "ไทย" }).click();

  await expect(page.getByText("ประวัติตั๋วงาน").first()).toBeVisible();
  await expect(page.getByPlaceholder(/^ค้นหาจาก ticket ที่ปิดแล้ว \d+ ใบ/)).toBeVisible();
  await expect(page.getByRole("button", { name: "ตัวกรอง", exact: true })).toBeVisible();
  // One Thai form covers every count — the language has no grammatical plural.
  await expect(page.getByText(/^ไม่มี ticket ปิด \d+ เดือน$/).first()).toBeVisible();

  // Thai dates are written in the Buddhist era, so the jump bar has to agree with
  // the heading it scrolls to: a bar reading 2026 above a "2569" heading is two
  // different answers to the same question.
  const years = page.getByRole("group", { name: "ข้ามไปปี" }).getByRole("button");
  const newest = (await years.first().textContent())!.trim();
  expect(Number(newest)).toBeGreaterThan(2500);
  await expect(
    page.getByText(new RegExp(`^\\S+ ${newest}$`)).first(),
  ).toBeVisible();
});

/**
 * The date range picker. The seed closes tickets relative to "now", so these
 * assert behaviour — what the label says, that stepping moves by the span's own
 * length, that an empty span says so — rather than which tickets land in a range.
 */
const rangeButton = (page: Page) =>
  page.getByRole("button", { name: /^(Any date|[A-Z][a-z]{2} \d)/ });

test("a preset narrows the log and names the span it picked", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  await expect(rangeButton(page)).toHaveText("Any date");
  await rangeButton(page).click();
  await page.getByRole("button", { name: "This year", exact: true }).click();

  // The label is the span, written by the locale — "Jan 1 – Aug 6, 2026".
  await expect(rangeButton(page)).toHaveText(/^Jan 1 – .+ \d{4}$/);
  await expect(page.getByText(/^\d+ matching$/)).toBeVisible();
  // Nothing older than this year survives the filter.
  await expect(page.getByText(/^[A-Z][a-z]+ 202[0-5]$/)).toHaveCount(0);
});

test("the arrows step by the length of the span that is selected", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  await rangeButton(page).click();
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  const start = await rangeButton(page).textContent();

  // Back one, then forward one, returns to exactly the same seven days.
  await page.getByRole("button", { name: "Earlier period" }).click();
  await expect(rangeButton(page)).not.toHaveText(start!);
  await page.getByRole("button", { name: "Later period" }).click();
  await expect(rangeButton(page)).toHaveText(start!);
});

test("a span with nothing in it says so, and can be left", async ({ page }) => {
  await login(page);
  await page.goto("/history");

  // Step the last seven days FORWARD into next week. Nothing closes in the
  // future, so that span is empty by construction rather than by whichever dates
  // the seed happens to have produced today.
  await rangeButton(page).click();
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await page.getByRole("button", { name: "Later period" }).click();

  await expect(page.getByText(/^Nothing was closed between /)).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rangeButton(page)).toHaveText("Any date");
  await expect(rows(page).first()).toBeVisible();
});

test("preset and custom range swap freely, without getting stuck", async ({
  page,
}) => {
  await login(page);
  await page.goto("/history");

  // Preset → custom.
  await rangeButton(page).click();
  await page.getByRole("button", { name: "This month", exact: true }).click();
  const presetLabel = await rangeButton(page).textContent();

  await rangeButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Date range" });
  // Days are addressed by their full date: the grid pads with the neighbouring
  // months, so "5" alone matches two cells.
  const shown = (await dialog
    .getByText(/^[A-Z][a-z]+ \d{4}$/)
    .first()
    .textContent())!;
  const [monthName, year] = shown.split(" ");
  // Later day first, to prove the ends get ordered rather than taken as given.
  await dialog
    .getByRole("button", { name: `${monthName} 12, ${year}`, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: `${monthName} 5, ${year}`, exact: true })
    .click();
  const customLabel = await rangeButton(page).textContent();
  expect(customLabel).not.toBe(presetLabel);
  expect(customLabel).toMatch(/5 – 12|12 – .+5/);

  // Custom → preset.
  await rangeButton(page).click();
  await page.getByRole("button", { name: "This year", exact: true }).click();
  await expect(rangeButton(page)).toHaveText(/^Jan 1 – /);

  // Preset → off.
  await rangeButton(page).click();
  await page
    .getByRole("dialog", { name: "Date range" })
    .getByRole("button", { name: "Any date", exact: true })
    .click();
  await expect(rangeButton(page)).toHaveText("Any date");
});

test("the range picker is translated, dates and all", async ({ page }) => {
  await login(page);
  await page.goto("/history");
  await page.getByRole("button", { name: "ไทย" }).click();

  const button = page.getByRole("button", { name: /^(ทุกช่วงเวลา|\d)/ });
  await expect(button).toHaveText("ทุกช่วงเวลา");
  await button.click();
  await expect(
    page.getByRole("button", { name: "7 วันล่าสุด", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "เดือนนี้", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ปีนี้", exact: true }).click();

  // Thai month names, and the Buddhist era the section headings already use.
  await expect(button).toHaveText(/25\d{2}$/);
  await expect(button).not.toHaveText(/20\d{2}$/);
});

test("on a phone the filters open as a sheet from the bottom edge", async ({
  page,
}) => {
  // A menu anchored under the button would open off-screen once the toolbar wraps,
  // so at this width the same panel becomes a sheet instead.
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page);
  await page.goto("/history");

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(720); // flush with the bottom
  expect(Math.round(box.width)).toBe(320); // and full width
  await expect(sheet.getByRole("button", { name: "Close filters" })).toBeVisible();
});

/**
 * The page is read on phones as often as on desktops, and the sticky search bar
 * plus sticky section headings are exactly the combination that breaks when the
 * toolbar wraps. 320px is the narrowest viewport still worth supporting.
 */
for (const [label, width] of [
  ["320", 320],
  ["375", 375],
  ["768", 768],
  ["1440", 1440],
] as const) {
  for (const lang of ["EN", "ไทย"] as const) {
    test(`lays out at ${label}px in ${lang} with no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 720 });
      await login(page);
      await page.goto("/history");
      if (lang === "ไทย") await page.getByRole("button", { name: "ไทย" }).click();
      await expect(rows(page).first()).toBeVisible();

      // Nothing may push the page sideways.
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        const main = document.querySelector("main")!;
        return {
          doc: de.scrollWidth - de.clientWidth,
          main: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.main).toBeLessThanOrEqual(0);

      // The sticky section headings must come to rest exactly at the search bar's
      // bottom edge, never under it. Asserted as the line itself rather than by
      // measuring a heading at some scroll offset: a heading being pushed out of
      // view by its own section legitimately slides behind the bar, so its
      // position at an arbitrary scrollTop proves nothing either way. The offset
      // is computed at runtime because the bar wraps to two lines at these widths.
      const measure = () =>
        page.evaluate(() => {
          const main = document.querySelector("main")!;
          const bar = main.querySelector(".sticky.top-0") as HTMLElement;
          const heading = document.querySelector(
            '[id^="closed-section-"]',
          ) as HTMLElement;
          const padding = parseFloat(getComputedStyle(main).paddingTop) || 0;
          const scrollportTop = main.getBoundingClientRect().top + padding;
          return {
            // Zero when the heading's resting line is the bar's bottom edge.
            drift:
              Math.round(scrollportTop + parseFloat(heading.style.top)) -
              Math.round(bar.getBoundingClientRect().bottom),
            // What keeps an outgoing heading hidden while it passes underneath.
            barOpaque:
              getComputedStyle(bar).backgroundColor !== "rgba(0, 0, 0, 0)",
            barAbove:
              Number(getComputedStyle(bar).zIndex) >
              Number(getComputedStyle(heading).zIndex),
          };
        });

      // Polled: the offset is re-measured by a ResizeObserver, so switching
      // language re-flows the bar a tick before the headings hear about it.
      await expect
        .poll(async () => (await measure()).drift)
        .toBe(0);
      const { barOpaque, barAbove } = await measure();
      expect(barOpaque).toBe(true);
      expect(barAbove).toBe(true);
    });
  }
}
