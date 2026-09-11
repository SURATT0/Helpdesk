import { apiRequest } from "@/lib/api-client";
import {
  createdCategorySchema,
  otherDescriptionListSchema,
  type OtherDescription,
} from "./schemas";

/** What people have been filing under "Other". Platform staff only. */
export async function fetchOtherDescriptions(): Promise<OtherDescription[]> {
  const body = await apiRequest("/categories/other-descriptions");
  return otherDescriptionListSchema.parse(body).data;
}

/**
 * Promote a phrase into a category of that customer's own.
 *
 * `code` is optional: the server derives one from the name, and only needs to be
 * told when the name has no letters or digits to derive from — a wholly Thai
 * name, most obviously.
 */
export async function createCategory(input: {
  name: string;
  customerId: number;
  code?: string;
}) {
  const body = await apiRequest("/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return createdCategorySchema.parse(body).data;
}
