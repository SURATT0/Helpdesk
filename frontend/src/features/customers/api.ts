import { apiRequest } from "@/lib/api-client";
import {
  archiveImpactEnvelope,
  customerEnvelope,
  customerListSchema,
  type Customer,
  type CustomerArchiveImpact,
} from "./schemas";

/**
 * The tenants the signed-in principal reaches. One name for almost everyone —
 * their own company — and the full list only for platform-wide staff.
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const body = await apiRequest("/customers");
  return customerListSchema.parse(body).data;
}

/** Create a tenant. `admin` and above; the server is the gate. */
export async function createCustomer(name: string): Promise<Customer> {
  const body = await apiRequest("/customers", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return customerEnvelope.parse(body).data;
}

export async function renameCustomer(
  id: number,
  name: string,
): Promise<Customer> {
  const body = await apiRequest(`/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return customerEnvelope.parse(body).data;
}

/**
 * What archiving would be refused for. Read before the destructive call so the
 * dialog shows the number the guard will refuse on, rather than a warning that
 * can disagree with the answer.
 */
export async function fetchArchiveImpact(
  id: number,
): Promise<CustomerArchiveImpact> {
  const body = await apiRequest(`/customers/${id}/archive-impact`);
  return archiveImpactEnvelope.parse(body).data;
}

/** Archive, never delete. Refused while the tenant still carries live work. */
export async function archiveCustomer(id: number): Promise<void> {
  await apiRequest(`/customers/${id}`, { method: "DELETE" });
}
