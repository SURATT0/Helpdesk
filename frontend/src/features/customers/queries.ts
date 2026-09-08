import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveCustomer,
  createCustomer,
  fetchArchiveImpact,
  fetchCustomers,
  renameCustomer,
} from "./api";

export const customerKeys = {
  all: ["customers"] as const,
  archiveImpact: (id: number) => ["customers", "archive-impact", id] as const,
};

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

/** Read lazily, when the archive dialog opens — not with the list. */
export function useArchiveImpact(id: number | null) {
  return useQuery({
    queryKey: customerKeys.archiveImpact(id ?? 0),
    queryFn: () => fetchArchiveImpact(id as number),
    enabled: id != null,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createCustomer(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}

export function useRenameCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      renameCustomer(id, name),
    // Wider than the customer list: a tenant's name is printed on tickets and
    // projects too, so a rename makes those stale.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useArchiveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => archiveCustomer(id),
    onSuccess: () => qc.invalidateQueries(),
  });
}
