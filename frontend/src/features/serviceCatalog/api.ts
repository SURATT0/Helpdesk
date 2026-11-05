import { apiRequest } from "@/lib/api-client";
import { serviceCatalogListSchema, type ServiceCatalogEntry } from "./schemas";

/** Every catalog entry, active or retired — the ticket filter's picker data. */
export async function fetchServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  const body = await apiRequest("/service-catalog");
  return serviceCatalogListSchema.parse(body).data;
}
