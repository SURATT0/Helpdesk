import { test, expect } from "@playwright/test";
import { login } from "./helpers";

// The seed now ages some in-flight tickets past their SLA target, so every state
// the badge can paint is reachable in a freshly seeded database — including
// breached-and-still-open, which used to exist only in a demo that had been
// running for days and so could not be asserted here at all.

test("a breached ticket says how far past its target it went", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  // Still open and already late — the row this column exists for.
  await expect(page.getByText(/^\d+[dhm].* over$/).first()).toBeVisible();
  // And finished late, which reads differently on purpose.
  await expect(page.getByText(/^missed by \d/).first()).toBeVisible();
  // Never "0h 0m", which is what every breach read as once the server clamped
  // the remaining time at zero.
  await expect(page.getByText(/0h 0m/)).toHaveCount(0);
});

test("the badge separates overdue, at risk and comfortable", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  // Three tiers on screen at once, which is the whole reason `danger` was split:
  // the server's five states fold the first two into one.
  await expect(page.getByLabel(/^SLA: Breached, still open/).first()).toBeVisible();
  await expect(page.getByLabel(/^SLA: At risk/).first()).toBeVisible();
  await expect(page.getByLabel(/^SLA: On track/).first()).toBeVisible();
  // And a paused one, whose clock is stopped rather than late.
  await expect(page.getByLabel(/^SLA: Paused/).first()).toBeVisible();
});

test("the still-open breaches are counted and can be filtered to", async ({
  page,
}) => {
  await login(page);
  await page.goto("/tickets");

  const tile = page.getByRole("button", { name: /\d+ breached, still open/ });
  await expect(tile).toBeVisible();
  const counted = Number(
    (await tile.textContent())?.match(/(\d+) breached/)?.[1],
  );
  expect(counted).toBeGreaterThan(0);

  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Open ticket #/ })).toHaveCount(
    counted,
  );
  await expect(page.getByLabel(/^SLA: Breached, still open/)).toHaveCount(counted);
  // Nothing that is merely close, and nothing already finished.
  await expect(page.getByText(/left$/)).toHaveCount(0);
  await expect(page.getByLabel(/^SLA: Met/)).toHaveCount(0);
});

test("sorting by SLA puts the worst overrun first", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");

  await page.getByRole("button", { name: "SLA", exact: true }).click();
  // The old sort re-parsed the display string, where every breach read "0h 0m"
  // and therefore sorted among the tickets that still had time.
  const first = page.getByLabel(/^SLA: /).first();
  await expect(first).toHaveAttribute(
    "aria-label",
    /^SLA: Breached, still open/,
  );
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

// Four surfaces used to render the SLA independently; three of them showed the
// server's clamped string while the list showed a real overrun. This pins that
// they now agree — reading the state rather than the countdown, so a minute
// ticking over between two page loads can't fail it.
test("the dashboard, the detail page and the board all state the same verdict", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard");

  const row = page.locator('a[href^="/tickets/"]').first();
  await expect(row).toBeVisible();
  const href = await row.getAttribute("href");
  const spoken = await row.getByLabel(/^SLA: /).getAttribute("aria-label");
  const state = spoken!.split(",")[0]; // "SLA: Breached, still open" → "SLA: Breached"

  await page.goto(href!);
  // Twice: the header pill and the properties rail, which must not disagree
  // with each other either.
  await expect(page.getByLabel(new RegExp(`^${state}`))).toHaveCount(2);

  await page.goto("/tickets");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByLabel(/^SLA: /).first()).toBeVisible();
});

test("the SLA facet ANDs with the other filters", async ({ page }) => {
  await login(page);
  await page.goto("/tickets");

  // The chip carries a "＋" while inactive; plain "SLA"/"Status" is the sort header.
  await page.getByRole("button", { name: "＋ SLA" }).click();
  // Exact: the summary tile above reads "3 breached, still open", and getByText
  // matches substrings case-insensitively, so a loose match would hit the tile.
  await page.getByText("Breached, still open", { exact: true }).click();
  // The facet menu closes by clicking away — it lays a full-screen catcher over
  // the page, which would otherwise swallow the click on the next chip.
  await page.mouse.click(5, 5);
  await expect(
    page.getByLabel(/^SLA: Breached, still open/).first(),
  ).toBeVisible();

  // A closed ticket cannot also be still open, so combining the two must empty
  // the list — if the facets ORed, it would fill it instead.
  await page.getByRole("button", { name: "＋ Status" }).click();
  // Unambiguous because every row on screen is open: none carries a Closed badge.
  await page.getByText("Closed", { exact: true }).click();
  await expect(page.getByText("No tickets match your filters")).toBeVisible();
});
