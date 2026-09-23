import { useQuery } from "@tanstack/react-query";
import { fetchServiceCatalog } from "./api";

export const serviceCatalogKeys = { all: ["service-catalog"] as const };

/**
 * The ticket list's service facet. Cached for the session like the customer
 * list: the catalog changes by config edit + redeploy, not by anything a
 * viewer does in the app.
 */
export function useServiceCatalog(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: serviceCatalogKeys.all,
    queryFn: fetchServiceCatalog,
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}
