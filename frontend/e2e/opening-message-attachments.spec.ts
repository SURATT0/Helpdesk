import { test, expect } from "@playwright/test";
import { DEMO, loginAs } from "./helpers";

/**
 * A file attached while the ticket was being raised shows up in the thread.
 *
 * The reported bug: a requester attaches a screenshot to the new-ticket form,
 * the agent opens the ticket, and the screenshot is nowhere in the conversation.
 *
 * Nothing was broken underneath it. The file uploaded (201), the row existed,
 * the bytes were served to the agent on request (200, `image/png`), and a
 * requester from another customer was refused (404). It had no bubble to appear
 * in: the new-ticket form uploads against the TICKET, because there is no
 * message yet to hang the file on, and the opening bubble is built from
 * `ticket.description` with its attachment list hard-coded empty.
 *
 * So the case is written from the agent's side, which is where it was noticed.
 */

const REQUESTER = "marcus.chen@acme.com";

/** A real 1x1 PNG — the server checks magic bytes, not the declared type. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

test("the agent sees the screenshot the requester raised the ticket with", async ({
  page,
}) => {
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();

  const subject = `Opening attachment ${Date.now()}`;
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Description").fill("The screenshot is attached.");
  // The modal's own picker, not the sidebar's — this ticket has no page yet.
  await page.setInputFiles('[role="dialog"] input[type="file"]:not([capture])', {
    name: "raised-with.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByText("raised-with.png")).toBeVisible();
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });
  const url = page.url();

  // The agent opens it. The image belongs in the FIRST bubble — the one holding
  // the description that talks about it — not only in the sidebar list.
  await loginAs(page, DEMO.email);
  await page.goto(url);
  await expect(page.getByText("The screenshot is attached.")).toBeVisible();

  // The GRID, not the `<img>` — the same handle chat-images.spec uses, and for
  // a reason worth keeping: the fixture is a 1×1 PNG, so the image element is
  // one CSS pixel and Playwright calls a 1px box hidden. Asserting on it made
  // this fail against a feature that was working, with the log showing the
  // decoded blob sitting right there in the bubble.
  const grid = page.getByTestId("chat-scroll").locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect(grid.locator("img")).toHaveCount(1);
  // A real picture rather than a broken one: the bytes arrived and decoded.
  await expect
    .poll(() =>
      grid.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBeGreaterThan(0);

  // And it is still listed in the sidebar — the bubble is an addition, not a
  // move. A chat file already appears in both places; this is the same
  // arrangement rather than a new one.
  await expect(page.getByText("raised-with.png")).toBeVisible();
});

test("a ticket raised with no files draws no empty attachment row", async ({
  page,
}) => {
  // The opening bubble now asks for a list that is usually empty, so the empty
  // case has to stay invisible rather than becoming a stray gap under every
  // description in the product.
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByLabel("Subject").fill(`No attachment ${Date.now()}`);
  await page.getByLabel("Description").fill("Nothing attached to this one.");
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });

  await expect(page.getByText("Nothing attached to this one.")).toBeVisible();
  await expect(
    page.getByTestId("chat-scroll").locator("[data-image-grid]"),
  ).toHaveCount(0);
});
