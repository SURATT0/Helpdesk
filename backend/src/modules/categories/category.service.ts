import {
  customerReach,
  hasPermission,
  isPlatformWide,
  type AuthUser,
} from "../../shared/auth";
import { BadRequest, Forbidden } from "../../shared/errors";
import { categoryCode } from "./category.code";
import {
  categoryRepository,
  createCategory,
  findOtherDescriptions,
  type Category,
  type OtherDescription,
} from "./category.repository";

/**
 * The permission writing the category list needs.
 *
 * The starting matrix gives it to `super_admin` and to nobody else — the same
 * arrangement `project:delete` and `customer:archive` use, and for the same
 * reason. A category is the shape of a tenant's reporting: adding one changes
 * what every future chart has a line for, and an agent working cases has no
 * occasion to.
 *
 * A STARTING point, not a rule: `role_permissions` is editable, so a desk that
 * wants its admins maintaining the list can say so, and this check reads the
 * live grant either way.
 *
 * Deliberately NOT applied to the LIST. Reading the categories is a picker's
 * data, needed by every requester to file anything at all, and already scoped to
 * the caller's reach in the repository.
 */
export const CATEGORY_WRITE = "category:write";

function assertMayWrite(actor: AuthUser): void {
  if (!hasPermission(actor, CATEGORY_WRITE)) {
    throw Forbidden("You don't have permission to manage categories");
  }
}

export const categoryService = {
  /**
   * The categories this principal may file under: those belonging to a customer
   * they reach, and nothing else.
   *
   * There is no longer a second source. This used to read "the shared ones, plus
   * any belonging to a customer they reach", and the first half is gone with the
   * shared rows — every category has an owner now, and a ticket may only carry
   * one of its own customer's.
   *
   * Scoped in the repository like every other list: a picker must not name a
   * tenant the caller cannot see.
   */
  list(actor: AuthUser): Promise<Category[]> {
    return categoryRepository.findMany(actor);
  },

  /**
   * What people have been typing under "Other".
   *
   * Behind the write permission rather than the read, because this is not a
   * picker's data: it is every phrase anybody in a tenant has typed into a free
   * text box, which is a different and more revealing thing than the list of
   * categories they may file under.
   */
  otherDescriptions(
    actor: AuthUser,
    filter: { customerId?: number; limit: number },
  ): Promise<OtherDescription[]> {
    assertMayWrite(actor);
    return findOtherDescriptions(actor, filter);
  },

  /**
   * Promote a description into a category of that customer's own.
   *
   * What this does NOT do is re-file the tickets that used the phrase. Their
   * category is what the desk actually worked them under, and rewriting it would
   * change what every past report says about a period that is already closed.
   * The promotion is about what can be filed from now on; the old tickets keep
   * their own words, which are still on the page.
   */
  async create(
    actor: AuthUser,
    input: { name: string; customerId: number; code?: string },
  ): Promise<Category> {
    assertMayWrite(actor);

    // Reach, not identity, and asked of the predicates rather than inferred
    // from what happens to be in the category list — a customer with no
    // categories at all is a tenant somebody can still be entitled to add one
    // to, and reading reach off its rows would refuse exactly that case.
    const inReach =
      isPlatformWide(actor) || customerReach(actor).includes(input.customerId);
    if (!inReach) {
      // Same wording whichever it is. Telling a caller that a customer exists
      // but is not theirs is answering the question they were refused.
      throw BadRequest("Unknown customer");
    }

    // The customer's existing categories, for the collision check below.
    const reachable = await categoryRepository.findMany(actor);

    const name = input.name.trim();
    const code = input.code ?? categoryCode(name);
    if (code.length === 0) {
      // `categoryCode` strips everything that is not a letter or digit, so a
      // name written entirely in Thai derives to an empty string. That is not a
      // usable identity, and silently storing one would break every report that
      // groups by it — so the caller is asked for a code instead of being given
      // a broken one.
      throw BadRequest(
        "This name has no code of its own — send a `code` (upper-case letters, digits and underscores)",
      );
    }

    const clash = reachable.find(
      (c) =>
        c.customerId === input.customerId &&
        (c.code === code || c.name.toLowerCase() === name.toLowerCase()),
    );
    if (clash) {
      // Checked before the insert so the answer says WHICH collision it is. The
      // two unique indexes would both surface as the same constraint violation,
      // and "that name is taken" and "that code is taken" need different fixes.
      throw BadRequest(
        clash.code === code
          ? `The code "${code}" is already used by "${clash.name}" for this customer`
          : `This customer already has a category called "${clash.name}"`,
      );
    }

    return createCategory(actor, { name, code, customerId: input.customerId });
  },
};
