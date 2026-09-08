import { useQuery } from "@tanstack/react-query";
import { fetchCustomers } from "./api";

export const customerKeys = { all: ["customers"] as const };

/**
 * The customer list behind every tenant picker.
 *
 * `enabled` because most screens never need it: a picker with one option is not
 * a choice, so callers ask only when reach is actually wider than one.
 * Customers change about never, so this is cached for the session rather than
 * refetched with the rest of a screen.
 */
export function useCustomers(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: customerKeys.all,
    queryFn: fetchCustomers,
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}
