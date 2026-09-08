import type { AuthUser } from "../../shared/auth";
import { categoryRepository, type Category } from "./category.repository";

export const categoryService = {
  /**
   * The categories this principal may file under: the shared ones, plus any
   * belonging to a customer they reach. Scoped in the repository like every
   * other list — a picker must not name a tenant the caller cannot see.
   */
  list(actor: AuthUser): Promise<Category[]> {
    return categoryRepository.findMany(actor);
  },
};
