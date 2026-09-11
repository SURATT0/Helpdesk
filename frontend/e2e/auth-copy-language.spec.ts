import { expect, test } from "@playwright/test";

/**
 * What the signed-out pages SAY, in the language the reader picked.
 *
 * Separate from `auth-pages.spec.ts`, which is deliberately hermetic and never
 * submits anything — these cases do submit, because the bug they guard against
 * only appeared on the screen after the round trip. Registration and the reset
 * request used to show the API's own English sentence, so somebody who had
 * filled in the Thai form was told what had happened in English.
 *
 * `/forgot-password` is submitted with an address that has no account: the reply
 * is identical either way by design, so these cases need nothing from the seed
 * and leave nothing behind.
 */

const NO_SUCH_ADDRESS = "nobody-has-this-address@example.invalid";

/** Switch the page to Thai using the toggle every AuthShell carries. */
async function switchToThai(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "ไทย" }).click();
}

test("the reset request answers in Thai when the form was read in Thai", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await switchToThai(page);

  await page.getByLabel("อีเมลที่ทำงาน").fill(NO_SUCH_ADDRESS);
  await page.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่าน" }).click();

  await expect(
    page.getByRole("heading", { name: "กรุณาตรวจสอบอีเมล" }),
  ).toBeVisible();
  await expect(page.getByText(/หากอีเมลนี้มีบัญชีอยู่ในระบบ/)).toBeVisible();
  // The sentence the API used to supply. Asserted absent rather than just
  // asserting the Thai one present: both could be on the page at once, and that
  // is exactly what a half-done fix looks like.
  await expect(page.getByText(/reset link is on its way/i)).toHaveCount(0);
});

test("and in English when the form was read in English", async ({ page }) => {
  await page.goto("/forgot-password");

  await page.getByLabel("Work email").fill(NO_SUCH_ADDRESS);
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(
    page.getByText(/If that address has an account, a reset link is on its way/),
  ).toBeVisible();
});

test("a refusal from the API is read out in Thai too", async ({ page }) => {
  await page.goto("/login");
  await switchToThai(page);

  await page.getByLabel("อีเมลที่ทำงาน").fill(NO_SUCH_ADDRESS);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();

  // The API answers INVALID_CREDENTIALS; the sentence is this side's. Before
  // that mechanism existed the page showed the API's "Invalid email or
  // password" — an English line under a Thai form, which is the whole reason
  // errors travel as codes.
  await expect(page.getByText("อีเมลหรือรหัสผ่านไม่ถูกต้อง")).toBeVisible();
  await expect(page.getByText(/Invalid email or password/i)).toHaveCount(0);
});

test("sign-up says what happens next in Thai", async ({ page }) => {
  await page.goto("/register");
  await switchToThai(page);

  // Unique per run: registering the same address twice is a different code path
  // by design, and this case is about the copy, not about that branch.
  const email = `signup-copy-${Date.now()}@example.invalid`;
  await page.getByLabel("ชื่อ-นามสกุล").fill("ผู้ทดสอบ ภาษาไทย");
  await page.getByLabel("อีเมลที่ทำงาน").fill(email);
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill("password123");
  await page.getByLabel("ยืนยันรหัสผ่าน").fill("password123");
  await page.getByRole("button", { name: "สร้างบัญชี" }).click();

  await expect(page.getByText(/ผู้ดูแลระบบจะต้องอนุมัติบัญชีก่อน/)).toBeVisible();
  await expect(page.getByText(/Check your email for a confirmation link/i)).toHaveCount(0);
});
