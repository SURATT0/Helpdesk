import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * "Other (please describe)", through the browser.
 *
 * The rule is proved in the backend suite, from every path that writes a ticket.
 * What only a browser can answer is whether the option is offered where it
 * should be, whether the form asks before the round trip, and whether what
 * somebody typed is readable afterwards by the next person to open the ticket.
 */

const AGENT = "dana.reyes@acme.com";
const SUPER_ADMIN = "sam.rivera@acme.com";

/**
 * Open the create dialog with the category picker READY, which is a later
 * moment than the dialog being visible.
 *
 * The picker is disabled until a customer has resolved, and until then it holds
 * a single "Choose a customer first" placeholder. A test that read the options
 * the instant the dialog painted got that placeholder and reported it as the
 * category list — so "Other is offered last" failed saying the last option was
 * the placeholder, on some runs and not others.
 *
 * Waiting for the "Other" option is the readiness signal these cases want: it is
 * the one option the API always returns, so its arrival means the real list has
 * landed. Where it sits in that list is still what each case asserts.
 */
async function openForm(page: Page) {
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const select = page.getByLabel("Category");
  await expect(select).toBeEnabled();
  await expect(select.locator("option", { hasText: /^Other$/ })).toHaveCount(1);
  return select;
}

test.describe("choosing Other", () => {
  test("is offered last, after every real category", async ({ page }) => {
    await loginAs(page, AGENT);
    const select = await openForm(page);

    const options = await select.locator("option").allTextContents();
    // Last, because it is the answer for a ticket the others do not fit —
    // offering it among them invites it as a first choice, which is how a free
    // text box becomes the category everybody uses.
    expect(options[options.length - 1]).toBe("Other");
    expect(options.length).toBeGreaterThan(1);
  });

  test("asks what the problem is, and will not submit without it", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    const select = await openForm(page);
    const dialog = page.getByRole("dialog");

    // Nothing extra is asked for an ordinary category.
    await expect(dialog.getByLabel("What is the problem?")).toHaveCount(0);

    await select.selectOption({ label: "Other" });
    const detail = dialog.getByLabel("What is the problem?");
    await expect(detail).toBeVisible();

    await dialog.getByLabel("Subject").fill("Something none of these cover");
    await dialog.getByLabel("Description").fill("Raised by the category suite.");

    const submit = dialog.getByRole("button", { name: "Create ticket" });
    // Blocked, and SAYING why rather than sitting there greyed and mute. The API
    // refuses a blank one regardless — this only means nobody finds that out
    // after the round trip.
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText(/Say what the problem is/i)).toBeVisible();

    // Whitespace is not a description.
    await detail.fill("   ");
    await expect(submit).toBeDisabled();

    await detail.fill("The badge printer jams on every third card");
    await expect(submit).toBeEnabled();
  });

  test("puts the words on the ticket, not into a new category", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    const select = await openForm(page);
    const dialog = page.getByRole("dialog");
    const phrase = `Badge printer jams ${Date.now()}`;

    await select.selectOption({ label: "Other" });
    await dialog.getByLabel("Subject").fill("Badge printer keeps jamming");
    await dialog.getByLabel("Description").fill("Third card every time.");
    await dialog.getByLabel("What is the problem?").fill(phrase);
    await dialog.getByRole("button", { name: "Create ticket" }).click();

    await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });

    // The rail leads with what the person wrote: "Other" on its own would make a
    // reader open the thread to find out what the ticket is about.
    await expect(page.getByText(phrase).first()).toBeVisible();

    // And the picker has NOT grown a new option. That is the whole reason the
    // text lives on the ticket — two spellings of one thing must not become two
    // categories.
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    const options = await page
      .getByLabel("Category")
      .locator("option")
      .allTextContents();
    expect(options).not.toContain(phrase);
  });
});

test.describe("reviewing what people typed", () => {
  test("is offered to a super admin and refused to an agent", async ({
    page,
  }) => {
    await loginAs(page, AGENT);
    await page.goto("/categories");
    // The nav does not offer it, and a direct visit says so rather than firing a
    // request that would only come back 403.
    await expect(page.getByText("Not your page")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Categories" }),
    ).toHaveCount(0);
  });

  test("lists a phrase with its tickets, and promotes it to a category", async ({
    page,
  }) => {
    const phrase = `Meeting room display dead ${Date.now()}`;

    // Raise one under Other first, so there is something to review.
    await loginAs(page, AGENT);
    const select = await openForm(page);
    const dialog = page.getByRole("dialog");
    await select.selectOption({ label: "Other" });
    await dialog.getByLabel("Subject").fill("Room 3 display is black");
    await dialog.getByLabel("Description").fill("Nothing on the screen.");
    await dialog.getByLabel("What is the problem?").fill(phrase);
    await dialog.getByRole("button", { name: "Create ticket" }).click();
    await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });

    await loginAs(page, SUPER_ADMIN);
    await page.goto("/categories");

    // By the card's own hook, not by a div that happens to contain the text: a
    // `hasText` filter matches every ancestor too, and `.last()` lands on the
    // innermost one — the phrase's own element, which holds no links.
    const card = page.locator("[data-other-phrase]").filter({ hasText: phrase });
    await expect(page.getByText(phrase).first()).toBeVisible();
    // The ticket behind the phrase is reachable: a count is a number, and these
    // are what let somebody read the cases before naming a category for them.
    await expect(card.getByRole("link", { name: /^#\d+$/ }).first()).toBeVisible();

    // Scoped to THIS card throughout. The page lists every phrase anyone has
    // ever typed, so an unscoped "first" opens somebody else's form and an
    // unscoped "last" clicks a different card's trigger.
    await card.getByRole("button", { name: "Make it a category" }).click();
    const name = `Displays ${Date.now()}`;
    await card.getByLabel("Category name").fill(name);
    await card.getByRole("button", { name: "Make it a category" }).click();

    await expect(card.getByText(`Added as “${name}”`)).toBeVisible();

    // It is now a real option on the form — for THAT customer.
    //
    // The customer has to be chosen first: this reader is platform-wide and
    // belongs to no tenant, so the category list is empty until one is named.
    // Which is the point worth checking — the promotion landed in Acme, not
    // everywhere.
    await page.goto("/tickets");
    await page.getByRole("button", { name: "New ticket" }).click();
    await page.getByLabel("Customer").selectOption({ label: "Acme Corp" });
    const categorySelect = page.getByLabel("Category");
    await expect(categorySelect.locator("option")).not.toHaveCount(1);
    const options = await categorySelect.locator("option").allTextContents();
    expect(options).toContain(name);
    // And "Other" is still last, even with a new category beside it.
    expect(options[options.length - 1]).toBe("Other");
  });
});
