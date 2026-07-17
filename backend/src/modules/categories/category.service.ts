import { categoryRepository, type Category } from "./category.repository";

export const categoryService = {
  list(): Promise<Category[]> {
    return categoryRepository.findMany();
  },
};
