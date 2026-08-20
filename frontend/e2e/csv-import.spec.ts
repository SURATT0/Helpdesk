import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * The CSV import's reading step — what the reader sees between choosing a file
 * and anything being created.
 *
 * Nothing here submits: every assertion is about the preview, which is where the
 * parser's mistakes used to arrive disguised as a plausible short import. The
 * suite therefore mutates no data and can run in parallel with the rest.
 *
 * The parser itself is unit-tested in `src/features/tickets/csv.test.ts`; these
 * cover the wiring the unit tests cannot — that the modal reaches the parser, and
 * that the file-level problems reach the reader in words.
 */

const HEADER = "subject,description,priority,category,requesterEmail";
const REQUESTER = "l.osei@acme.com";

async function importFile(page: Page, body: string) {
  await login(page);
  await page.goto("/tickets");
  await page.getByRole("button", { name: /Import CSV/i }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(body, "utf8"),
  });
}

/** Every value currently sitting in the review grid. */
const values = (page: Page) =>
  page
    .locator("input")
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value).filter(Boolean),
    );

test("an inch mark does not swallow the rest of the file", async ({ page }) => {
  // One unpaired `"` used to put the parser into quoted mode for the remainder
  // of the document: three rows arrived as one cell, and the columns after the
  // mark were gone. CRLF too, because that is what a spreadsheet writes.
  await importFile(
    page,
    [
      HEADER,
      `Monitor 24" is dead,Body one,high,Hardware,${REQUESTER}`,
      `Ticket two,Body two,low,Software,${REQUESTER}`,
      `Ticket three,Body three,medium,Network,${REQUESTER}`,
    ].join("\r\n"),
  );

  await expect(page.getByText("3 rows loaded")).toBeVisible();
  expect(await values(page)).toContain('Monitor 24" is dead');
  expect(await values(page)).toContain("Ticket three");
});

test("a semicolon-delimited file is read, commas and all", async ({ page }) => {
  // Excel writes `;` wherever the system list separator is one. Such a file
  // opens fine in Excel, so "missing every required column" was all the reader
  // had to go on.
  await importFile(
    page,
    [
      "subject;description;priority;category;requesterEmail",
      `Printer jam;Tray 2, lower;high;Hardware;${REQUESTER}`,
    ].join("\r\n"),
  );

  await expect(page.getByText("1 rows loaded")).toBeVisible();
  await expect(page.getByText(/missing required columns/i)).toHaveCount(0);
  // The comma inside the description is data here, not a separator.
  expect(await values(page)).toContain("Tray 2, lower");
});

test("a file left inside a quoted field says so instead of importing short", async ({
  page,
}) => {
  await importFile(
    page,
    [
      HEADER,
      `"never closed,Body,high,Hardware,${REQUESTER}`,
      `Ticket two,Body two,low,Software,${REQUESTER}`,
    ].join("\r\n"),
  );

  await expect(page.getByText(/quotation mark/i)).toBeVisible();
  // And it must not silently offer whatever survived.
  await expect(page.getByText(/rows loaded/)).toHaveCount(0);
});

test("Thai text survives a BOM and CRLF line endings", async ({ page }) => {
  // What a Thai Excel user's export actually looks like.
  await importFile(
    page,
    "\uFEFF" +
      [
        HEADER,
        `เครื่องพิมพ์ติด ถาด 2,กระดาษติดบ่อยมาก,high,Hardware,${REQUESTER}`,
      ].join("\r\n"),
  );

  await expect(page.getByText("1 rows loaded")).toBeVisible();
  expect(await values(page)).toContain("เครื่องพิมพ์ติด ถาด 2");
  expect(await values(page)).toContain("กระดาษติดบ่อยมาก");
});
