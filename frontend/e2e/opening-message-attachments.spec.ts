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

/**
 * A ticket from the seed — which is to say, one that predates the opening
 * comment, since the migration backfills none of them. Its description is what
 * the first bubble is built from, so it is also how that bubble is found.
 */
const SEEDED = {
  id: 1042,
  description: "VPN drops every 10 minutes after 4.2 update (seeded demo ticket).",
};

/** A real 1x1 PNG — the server checks magic bytes, not the declared type. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Enough of a PDF to be one. The sniff reads the leading `%PDF`, so this is a
 * genuine document as far as the server is concerned — which is the point: a
 * file that is not an image must not be handed an `<img>`.
 */
const PDF = Buffer.from("%PDF-1.4\n% a one-line document\n%%EOF\n", "latin1");

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

test("a ticket from before the opening message was a row still shows its files", async ({
  page,
}) => {
  // The fallback, and the only place it is exercised. The migration backfills
  // nothing, so every ticket raised before it — which is every ticket that
  // already exists — still has its description drawn from `ticket.description`
  // rather than from a comment. A file belonging to the TICKET rather than to
  // any message has to appear on that bubble, or for those tickets it goes back
  // to appearing nowhere, which is the bug.
  //
  // The rail's upload is how one is made: it attaches to the ticket, not to a
  // message, on any ticket at all.
  await loginAs(page, DEMO.email);
  await page.goto(`/tickets/${SEEDED.id}`);
  await expect(page.getByText(SEEDED.description)).toBeVisible();

  const name = `rail-${Date.now()}.png`;
  await page
    .getByTestId("attachments-panel")
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name, mimeType: "image/png", buffer: PNG });

  // The rail renames what it stores — `T<id>-<seq>-<slug>.<ext>` — so the slug
  // is the part to look for, not the name as it was uploaded.
  await expect(page.getByText(new RegExp(name.replace(/\.png$/, "")))).toBeVisible({
    timeout: 15_000,
  });

  // Inside the FIRST bubble, not merely somewhere on the page: this ticket is
  // shared with other specs that post images of their own into the thread, so
  // "the conversation has a picture in it" would pass without the fallback.
  const opening = page.getByText(SEEDED.description).locator("xpath=..");
  await expect(opening.locator("[data-image-grid]")).toBeVisible({
    timeout: 15_000,
  });
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

test("a document raised with the ticket is a card to download, not a torn image", async ({
  page,
}) => {
  // The opening bubble takes whatever was attached, and not everything attached
  // is a picture. `isImage` comes from the server's own sniff, so a PDF has to
  // land in the file list rather than being given an `<img>` that can only fail.
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();

  const body = `A document, not a picture ${Date.now()}`;
  await page.getByLabel("Subject").fill(`Opening document ${Date.now()}`);
  await page.getByLabel("Description").fill(body);
  await page.setInputFiles('[role="dialog"] input[type="file"]:not([capture])', {
    name: "report.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });

  await loginAs(page, DEMO.email);
  await page.goto(page.url());

  const opening = page.getByText(body).locator("xpath=..");
  // Named by the file it downloads, which is also how a screen reader finds it.
  await expect(
    opening.getByRole("button", { name: /report\.pdf/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(opening.locator("[data-image-grid]")).toHaveCount(0);
});

test("the opening bubble's picture fits a phone", async ({ page }) => {
  // 375px is the narrowest width the product is built for, and the grid caps its
  // own width rather than the cell's — so a bubble that behaves on a desktop can
  // still push the conversation sideways here.
  await page.setViewportSize({ width: 375, height: 720 });
  await loginAs(page, REQUESTER);
  await page.goto("/tickets");
  await page.getByRole("button", { name: "New ticket" }).click();

  const body = `Narrow screen ${Date.now()}`;
  await page.getByLabel("Subject").fill(`Phone width ${Date.now()}`);
  await page.getByLabel("Description").fill(body);
  await page.setInputFiles('[role="dialog"] input[type="file"]:not([capture])', {
    name: "on-a-phone.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/\d+$/, { timeout: 15_000 });

  const opening = page.getByText(body).locator("xpath=..");
  const grid = opening.locator("[data-image-grid]");
  await expect(grid).toBeVisible({ timeout: 15_000 });

  // The whole document, not the grid alone: an overflowing child is only a bug
  // if it is what makes the page scroll sideways, and that is the thing a person
  // actually experiences.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
