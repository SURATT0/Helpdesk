import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Every column-grid table, read on a phone.
 *
 * These tables are CSS grids with mostly-fixed px column templates, which on a
 * narrow viewport fail in one of two ways unless something holds them apart:
 * either the grid keeps its width and an ancestor's `overflow-hidden` clips the
 * last columns away with nothing able to scroll to them, or the grid shrinks and
 * its `1fr` column — the one carrying the subject line, or the compliance bar —
 * collapses towards zero.
 *
 * The Dashboard shipped with the first failure: at 375px it hid 280px of the My
 * Tickets table, SLA Due included, and its subject column measured 43px. Four of
 * the other tables had the scroller-plus-floor pairing and that one simply did
 * not, which is the whole reason `TableScroll` now owns both halves. This suite
 * is what stops the pairing being forgotten again.
 *
 * Asserted structurally rather than by column name, so it keeps working in
 * either language and survives a header being relabelled. Signed in as a
 * super_admin because Projects and the activity log are gated on that role and
 * would otherwise render a forbidden state with no table in it.
 */

const SUPER_ADMIN = "morgan.lee@acme.com";

// [label, path] — every page in the sidebar that draws a column-grid table.
const TABLE_PAGES = [
  ["Dashboard", "/dashboard"],
  ["Tickets", "/tickets"],
  ["Users", "/users"],
  ["Projects", "/projects"],
  ["Activity log", "/audit"],
  ["Reports", "/reports"],
] as const;

/**
 * Finds the widest CSS grid with four or more columns — the table — and reports
 * whether its last header cell can be brought fully into view by scrolling
 * whichever ancestor scrolls horizontally. `noneNeeded` covers the wide-viewport
 * case where the table already fits and no scroller is involved.
 */
async function probeLastColumn(page: Page) {
  return page.evaluate(() => {
    let grid: HTMLElement | null = null;
    let widest = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("div"))) {
      const cs = getComputedStyle(el);
      if (cs.display !== "grid") continue;
      if (cs.gridTemplateColumns.split(" ").length < 4) continue;
      if (el.scrollWidth > widest) {
        widest = el.scrollWidth;
        grid = el;
      }
    }
    if (!grid) return { found: false as const };

    const cell = grid.lastElementChild as HTMLElement | null;
    if (!cell) return { found: false as const };

    // The `1fr` track is the second one in every template here.
    const oneFr = parseFloat(getComputedStyle(grid).gridTemplateColumns.split(" ")[1]);

    let node: HTMLElement | null = grid;
    let scroller: HTMLElement | null = null;
    while (node) {
      const cs = getComputedStyle(node);
      if (
        (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth
      ) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }

    const fits = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      // A pixel of tolerance: sub-pixel track widths round either way.
      return r.right <= window.innerWidth + 1 && r.left >= -1;
    };

    if (!scroller) {
      return { found: true as const, noneNeeded: true, reachable: fits(cell), oneFr };
    }
    const restore = scroller.scrollLeft;
    scroller.scrollLeft = scroller.scrollWidth;
    const reachable = fits(cell);
    scroller.scrollLeft = restore;
    return { found: true as const, noneNeeded: false, reachable, oneFr };
  });
}

for (const [label, path] of TABLE_PAGES) {
  test(`${label}: the last column can be reached on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await loginAs(page, SUPER_ADMIN);
    await page.goto(path);

    const probe = await expect
      .poll(async () => (await probeLastColumn(page)).found, { timeout: 15_000 })
      .toBe(true)
      .then(() => probeLastColumn(page));

    expect(probe.found).toBe(true);
    if (!probe.found) return;

    // The column at the far right must be readable, not merely present in the
    // DOM: clipped-and-unscrollable is precisely the defect being guarded.
    expect(probe.reachable).toBe(true);

    // And the flexible column must not have been squeezed out to buy that.
    // 80px is about six characters — below it the cell is decoration.
    expect(probe.oneFr).toBeGreaterThan(80);
  });
}

test("no table page scrolls the document sideways at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await loginAs(page, SUPER_ADMIN);

  for (const [label, path] of TABLE_PAGES) {
    await page.goto(path);
    // Wait for the table to exist before measuring, or an empty page passes.
    await expect
      .poll(async () => (await probeLastColumn(page)).found, { timeout: 15_000 })
      .toBe(true);

    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      const main = document.querySelector("main");
      return {
        doc: de.scrollWidth - de.clientWidth,
        // `main` legitimately scrolls a little on pages whose own content is
        // wider, so this only asserts the document itself stays put.
        mainExists: main != null,
      };
    });
    expect(overflow.doc, `${label} pushes the document sideways`).toBeLessThanOrEqual(0);
  }
});
