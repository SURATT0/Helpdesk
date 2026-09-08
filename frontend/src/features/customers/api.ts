import { apiRequest } from "@/lib/api-client";
import { customerListSchema, type Customer } from "./schemas";

/**
 * The tenants the signed-in principal reaches. One name for almost everyone —
 * their own company — and the full list only for platform-wide staff.
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const body = await apiRequest("/customers");
  return customerListSchema.parse(body).data;
}
