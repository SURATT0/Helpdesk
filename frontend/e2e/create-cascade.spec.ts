import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Customer → Project → Category, on the create dialog.
 *
 * Run as the platform-wide super admin, because they are the only principal
 * with a real customer choice — everyone else reaches one tenant, where the
 * field is preselected and fixed and there is no cascade to test.
 *
 * Measured at three widths rather than one: the two new selects share a row
 * from `sm` up and stack below it, and a control squeezed to 110px is not a
 * control. 768px is the breakpoint either side of which that flips.
 */
const WIDTHS = [375, 390, 768];

for (const width of WIDTHS) {
  test(`the create dialog cascades customer → project → category at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await loginAs(page, "sam.rivera@acme.com");
    await page.goto("/tickets");
    await page.getByRole("button", { name: /new ticket|สร้าง ticket/i }).click();

    const customer = page.locator("#ticket-customer");
    const project = page.locator("#ticket-project");
    const category = page.locator("#ticket-category");

    // Disabled, not merely empty. An enabled picker with nothing in it reads as
    // "this customer has no projects" when the answer is "choose one first".
    await expect(customer).toBeVisible();
    await expect(project).toBeDisabled();
    await expect(category).toBeDisabled();

    await customer.selectOption({ label: "Acme Corp" });
    await expect(project).toBeEnabled();
    await expect(category).toBeEnabled();
    await project.selectOption({ label: "Acme Migration" });

    // The reset: a project belongs to the tenant it was chosen under, so
    // changing the customer must not leave it pointing at the other one's.
    await customer.selectOption({ label: "Globex Inc" });
    await expect(project).toHaveValue("");
    await expect(
      project.locator("option", { hasText: "Acme Migration" }),
    ).toHaveCount(0);

    // Usable at this width, and the page does not scroll sideways.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    for (const el of [customer, project, category]) {
      const box = await el.boundingBox();
      expect(box!.width, `control width at ${width}px`).toBeGreaterThan(150);
    }
  });
}
