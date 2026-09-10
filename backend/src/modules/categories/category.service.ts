import type { AuthUser } from "../../shared/auth";
import { categoryRepository, type Category } from "./category.repository";

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
};
