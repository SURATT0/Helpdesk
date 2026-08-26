import { test, expect } from "@playwright/test";
import { login, loginAs } from "./helpers";

test("browse the knowledge base and open an article", async ({ page }) => {
  await login(page);
  await page.goto("/kb");

  const card = page.getByText("Reset your corporate email password");
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(/\/kb\/KB-017/);
  await expect(
    page.getByRole("heading", { name: "Reset your corporate email password" }),
  ).toBeVisible();
});

test("filter KB by category", async ({ page }) => {
  await login(page);
  await page.goto("/kb");
  await page.getByRole("button", { name: "Network", exact: true }).click();
  await expect(
    page.getByText("VPN 4.2 keepalive bug — rollback steps"),
  ).toBeVisible();
  // An Email-category article should be filtered out.
  await expect(
    page.getByText("Reset your corporate email password"),
  ).toHaveCount(0);
});

/**
 * Authoring, end to end.
 *
 * The article this writes is deleted by the same test rather than left behind:
 * the suite shares one database with the specs above, which assert on the
 * seeded library by name and count.
 */
test("write a draft, publish it, then delete it", async ({ page }) => {
  const TITLE = "E2E — spooler article, deleted by this test";
  await login(page);
  await page.goto("/kb");

  await page.getByRole("button", { name: "New article" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Title").fill(TITLE);
  await dialog.getByLabel("Category").selectOption({ label: "Hardware" });
  await dialog
    .getByLabel("Summary")
    .fill("Written by an end-to-end test, and removed again before it ends.");
  await dialog
    .getByLabel("Article", { exact: true })
    .fill("## Fix\n\nRestart the spooler, then clear the queue directory.");
  // Deliberately sloppy: repeated, mixed case, padded, trailing comma.
  await dialog.getByLabel("Tags").fill("Printer, printer,  SPOOLER , ");

  await dialog.getByRole("button", { name: "Save draft" }).click();

  // Straight to the new article, which carries the id the server assigned.
  await expect(page).toHaveURL(/\/kb\/KB-\d+/);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const url = page.url();

  // Publishing is a status patch, and the badge is what says it worked.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete article" })
    .click();

  // Back to the library, with the article gone from it.
  await expect(page).toHaveURL(/\/kb$/);
  await expect(page.getByText(TITLE)).toHaveCount(0);

  // And gone for good: its own page now says so, rather than offering a retry.
  await page.goto(url);
  await expect(page.getByText("Article not found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a requester is offered no way to write or change an article", async ({
  page,
}) => {
  await loginAs(page, "marcus.chen@acme.com");
  await page.goto("/kb");

  await expect(page.getByText("Reset your corporate email password")).toBeVisible();
  await expect(page.getByRole("button", { name: "New article" })).toHaveCount(0);

  await page.goto("/kb/KB-017");
  await expect(
    page.getByRole("heading", { name: "Reset your corporate email password" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});
