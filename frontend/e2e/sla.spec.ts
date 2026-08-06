import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// These assert on tickets that were closed *after* their target, because that is
// the one breach a freshly seeded database is guaranteed to hold: the seed gives
// every open ticket a `due_at` measured from seed time, so nothing is overdue
// while still open until the demo has been running for a while. Judging the
// closed ones needs the same timestamps and the same helper, so the coverage is
// the same — it just doesn't depend on how old the database is.

test("a breached ticket says how far past its target it went", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  // "missed by 3d" — not "0h 0m", which is what every breach used to read as
  // once the server clamped the remaining time at zero.
  await expect(page.getByText(/^missed by \d/).first()).toBeVisible();
  await expect(page.getByText(/0h 0m/)).toHaveCount(0);
});

test("the summary tile filters the list to the breaches it counted", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  const tile = page.getByRole("button", { name: /\d+ breached, closed/ });
  await expect(tile).toBeVisible();
  const counted = Number(
    (await tile.textContent())?.match(/(\d+) breached/)?.[1],
  );
  expect(counted).toBeGreaterThan(0);

  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");

  // Every remaining row is one of the breaches the tile counted: the same number
  // of rows, each one labelled with that state and no other.
  await expect(page.getByRole("button", { name: /^Open ticket #/ })).toHaveCount(
    counted,
  );
  await expect(page.getByLabel(/^SLA: Breached, closed/)).toHaveCount(counted);
  await expect(page.getByLabel(/^SLA: Met/)).toHaveCount(0);
});

test("the SLA facet ANDs with the other filters", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");

  // The chip carries a "＋" while inactive; plain "SLA"/"Status" is the sort header.
  await page.getByRole("button", { name: "＋ SLA" }).click();
  // Exact: the summary tile above reads "14 breached, closed", and getByText
  // matches substrings case-insensitively, so a loose match would hit the tile.
  await page.getByText("Breached, closed", { exact: true }).click();
  // The facet menu closes by clicking away — it lays a full-screen catcher over
  // the page, which would otherwise swallow the click on the next chip.
  await page.mouse.click(5, 5);
  await expect(page.getByLabel(/^SLA: Breached, closed/).first()).toBeVisible();

  // A ticket nobody has picked up yet cannot also have been closed late, so
  // combining the two must empty the list — if the facets ORed, it would fill it.
  await page.getByRole("button", { name: "＋ Status" }).click();
  // Unambiguous because every row on screen is closed: none carries a New badge.
  await page.getByText("New", { exact: true }).click();
  await expect(page.getByText("No tickets match your filters")).toBeVisible();
});
