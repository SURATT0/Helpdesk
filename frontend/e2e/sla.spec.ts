import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// The whole point of the column is that a late ticket is unmissable, so these
// assert what the screen actually says — an overrun in words, not a colour.

test("an overdue ticket says how far past due it is", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");

  // "2h 14m over" — never "0h 0m", which is what every breached ticket used to
  // read as once the server clamped the remaining time at zero.
  const overdue = page.getByText(/\d+[dhm].* over$/).first();
  await expect(overdue).toBeVisible();
  await expect(page.getByText(/0h 0m/)).toHaveCount(0);
});

test("the summary tile filters the list to the breaches it counted", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  const tile = page.getByRole("button", {
    name: /\d+ breached, still open/,
  });
  await expect(tile).toBeVisible();
  const counted = Number(
    (await tile.textContent())?.match(/(\d+) breached/)?.[1],
  );
  expect(counted).toBeGreaterThan(0);

  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");

  // Every remaining row is one of the breaches the tile counted: same number of
  // rows, and each one reading as overdue rather than as time still in hand.
  await expect(page.getByRole("button", { name: /^Open ticket #/ })).toHaveCount(
    counted,
  );
  await expect(page.getByLabel(/^SLA: Breached, still open/)).toHaveCount(
    counted,
  );
  await expect(page.getByText(/left$/)).toHaveCount(0);
});

test("the SLA facet ANDs with the other filters", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");

  await page.getByRole("button", { name: /^SLA/ }).click();
  await page.getByText("Breached, still open").click();
  await page.keyboard.press("Escape");

  // A closed ticket can never be breached-and-still-open, so combining the two
  // must empty the list — if the facets ORed, it would fill it instead.
  // The chip carries a "＋" while inactive; plain "Status" is the sort header.
  await page.getByRole("button", { name: "＋ Status" }).click();
  // Unambiguous because the rows on screen are all still open: none of them is
  // carrying a Closed badge of its own.
  await page.getByText("Closed", { exact: true }).click();
  await expect(page.getByText("No tickets match your filters")).toBeVisible();
});
