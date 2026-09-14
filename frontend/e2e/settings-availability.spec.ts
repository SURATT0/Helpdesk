import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Who is offered the "accepting work" switch.
 *
 * It is shown to the people it can do something for and hidden from the one
 * person it cannot. `mayReceiveAssignment` on the server refuses a candidate
 * whose role is `user` before it looks at anything else, so a requester's flag
 * is never read by routing — a switch they could flip and watch do nothing.
 *
 * Hidden, not removed: the column, the routing that reads it and the admin's own
 * toggle in the user directory are all untouched. These cases pin which half of
 * that is true, because "we hid it" and "we deleted it" look identical from this
 * page and are very different everywhere else.
 */

const REQUESTER = "marcus.chen@acme.com";
const AGENT = "dana.reyes@acme.com";
const SUPER_ADMIN = "morgan.lee@acme.com";

// The section's heading and the switch's own label — the heading is what a
// requester must not see at all, the label is what staff must be able to click.
const HEADING = "Availability";
const SWITCH = "Accepting new tickets";

test("a requester is not offered it", async ({ page }) => {
  await loginAs(page, REQUESTER);
  await page.goto("/settings");

  // The page itself still works for them — the account, language and sign-out
  // sections are theirs.
  await expect(page.getByText("Account", { exact: true })).toBeVisible();
  await expect(page.getByText(HEADING)).toHaveCount(0);
  await expect(page.getByText(SWITCH)).toHaveCount(0);
});

test("an agent is, and it is theirs to change without asking anyone", async ({
  page,
}) => {
  await loginAs(page, AGENT);
  await page.goto("/settings");

  const toggle = page.getByRole("checkbox", { name: SWITCH });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
});

test("a super admin is too", async ({ page }) => {
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/settings");
  await expect(page.getByRole("checkbox", { name: SWITCH })).toBeVisible();
});

test("the flag is still there for an admin to set on somebody else", async ({
  page,
}) => {
  // The other half of "hidden, not removed". The user directory's own column is
  // what an administrator uses, and it is untouched — so the routing input a
  // requester can no longer see is still something the desk can manage.
  await loginAs(page, SUPER_ADMIN);
  await page.goto("/users");
  // Its accessible name is the column heading plus the person's own name, so a
  // reader hears whose availability each row's switch is.
  await expect(
    page.getByRole("checkbox", { name: /ROUTING — / }).first(),
  ).toBeVisible();
});
