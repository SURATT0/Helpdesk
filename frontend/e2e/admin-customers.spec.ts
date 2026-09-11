import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Customers and their projects on one screen.
 *
 * What these cases are for is the SHAPE: two panes on a desktop, one at a time
 * on a phone, and a URL that carries the selection so a customer can be linked
 * to and gone back from. The CRUD that lives in the detail pane arrives in its
 * own commits and gets its own cases.
 */

const SUPER_ADMIN = "sam.rivera@acme.com";
const AGENT = "dana.reyes@acme.com";
const PHONE = { width: 375, height: 720 };

test.describe("on a desktop", () => {
  test("lists customers with their project counts, and picks one", async ({
    page,
  }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    // Nothing chosen yet: the detail pane invites a choice rather than sitting
    // blank.
    await expect(page.getByText(/Choose a customer/i)).toBeVisible();

    const acme = page.getByRole("link", { name: /Acme Corp/ });
    await expect(acme).toBeVisible();
    // The count somebody scanning for "which customer has work set up" wants.
    await expect(acme).toContainText(/\d+ projects/);

    await acme.click();

    // The URL carries the selection, so this is linkable and reloadable.
    await expect(page).toHaveURL(/\/admin\/customers\/\d+$/);
    await expect(
      page.getByRole("heading", { name: "Acme Corp" }),
    ).toBeVisible();
    // Both panes are on screen at this width — that is what master–detail is for.
    await expect(page.getByRole("link", { name: /Globex Inc/ })).toBeVisible();
  });

  test("shows the customer's own projects, and nobody else's", async ({
    page,
  }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: /Globex Inc/ }).click();
    await expect(
      page.getByRole("heading", { name: "Globex Inc" }),
    ).toBeVisible();

    // Globex runs one project; Acme's must not appear under it.
    await expect(page.getByRole("button", { name: /Globex Rollout/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Acme Migration/ })).toHaveCount(0);
  });

  test("filters the list as you type", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    await page.getByPlaceholder("Search customers").fill("glob");
    await expect(page.getByRole("link", { name: /Globex Inc/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Acme Corp/ })).toHaveCount(0);

    await page.getByPlaceholder("Search customers").fill("zzz");
    await expect(page.getByText(/No customer matches/i)).toBeVisible();
  });

  test("survives a reload on a selected customer", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: /Acme Corp/ }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/\d+$/);

    await page.reload();
    // The selection is in the URL, not in state, so a reload lands back on it.
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("is one screen at a time, with a way back", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    // Level one: the list IS the page. No squeezed second column.
    await expect(page.getByRole("link", { name: /Acme Corp/ })).toBeVisible();
    await expect(page.getByText(/Choose a customer/i)).toBeHidden();

    await page.getByRole("link", { name: /Acme Corp/ }).click();

    // Level two: the detail, and the list is gone rather than beside it.
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Globex Inc/ })).toBeHidden();

    // Back to level one.
    await page.getByRole("link", { name: "All customers" }).click();
    await expect(page).toHaveURL(/\/admin\/customers$/);
    await expect(page.getByRole("link", { name: /Globex Inc/ })).toBeVisible();
  });

  test("neither level scrolls sideways", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);

    const noSidewaysScroll = async (where: string) => {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, where).toBeLessThanOrEqual(clientWidth + 1);
    };

    // Each level waits on the thing that is VISIBLE at that level. The other
    // pane is still in the document — `hidden lg:flex` is a class, not an
    // unmount — so a locator that matches it would resolve and then never be
    // visible, which is what this test did on its first run.
    await page.goto("/admin/customers");
    await expect(page.getByPlaceholder("Search customers")).toBeVisible();
    await noSidewaysScroll("list");

    await page.getByRole("link", { name: /Acme Corp/ }).click();
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await noSidewaysScroll("detail");
  });
});

test.describe("who may open it", () => {
  test("an agent is refused, and keeps the routing table instead", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/admin/customers");
    await expect(page.getByText("Not your page")).toBeVisible();

    // The half that makes the refusal defensible: an agent working cases still
    // needs to see where their queue's work comes from.
    await page.goto("/projects");
    await expect(
      page.getByRole("heading", { name: /Projects|Routing/i }).or(
        page.getByText("Acme Migration"),
      ).first(),
    ).toBeVisible();
  });
});

test.describe("managing customers", () => {
  test("adds one, and lands on it", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    const name = `Probe Industries ${Date.now()}`;
    await page.getByRole("button", { name: "Add customer" }).click();
    await page.getByLabel("Company name").fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add customer" })
      .click();

    // Landed on the new one rather than left to find it in a longer list.
    await expect(page).toHaveURL(/\/admin\/customers\/\d+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  });

  test("says which kind of name collision it is", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    await page.getByRole("button", { name: "Add customer" }).click();
    await page.getByLabel("Company name").fill("Acme Corp");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add customer" })
      .click();

    // The SERVER's sentence, because it distinguishes a live namesake from an
    // archived one — and an archived one is solved by reviving a row this list
    // does not contain, which "that name is taken" would send somebody hunting
    // through the list for.
    // Scoped to the dialog: Next's own route announcer is a `role="alert"` too,
    // so an unscoped one matches two elements and resolves to the empty one.
    await expect(
      page.getByRole("dialog").getByRole("alert"),
    ).toContainText(/already called/i);
    // Still open, with what was typed still in it.
    await expect(page.getByLabel("Company name")).toHaveValue("Acme Corp");
  });

  test("renames one", async ({ page }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");

    const original = `Renamable ${Date.now()}`;
    await page.getByRole("button", { name: "Add customer" }).click();
    await page.getByLabel("Company name").fill(original);
    await page.getByRole("dialog").getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByRole("heading", { name: original })).toBeVisible();

    const renamed = `${original} (renamed)`;
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Company name").fill(renamed);
    await page.getByRole("button", { name: "Save name" }).click();

    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  });

  test("refuses to archive a customer that still has things under it, and counts them", async ({
    page,
  }) => {
    await loginAs(page, SUPER_ADMIN);
    await page.goto("/admin/customers");
    await page.getByRole("link", { name: /Acme Corp/ }).click();

    await page.getByRole("button", { name: "Archive" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The numbers, not a raw refusal. They come from the server's own impact
    // endpoint — the same figures the guard refuses on — so the dialog cannot
    // promise an archive the API then declines.
    await expect(dialog).toContainText(/\d+/);
    const confirm = dialog.getByRole("button", { name: /Archive/ });
    await expect(confirm).toBeDisabled();
  });
});

test("the old customers route redirects rather than 404s", async ({ page }) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/customers");
  // Bookmarks, history and pasted links all still work.
  await expect(page).toHaveURL(/\/admin\/customers$/);
  await expect(page.getByPlaceholder("Search customers")).toBeVisible();
});
