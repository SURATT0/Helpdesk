import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ticketKeys } from "@/features/tickets/queries";
import { fetchEmailStatus, fetchSources, syncSource } from "./api";

export const integrationKeys = {
  sources: ["integrations", "sources"] as const,
  emailStatus: ["integrations", "email-status"] as const,
};

export function useSources() {
  return useQuery({
    queryKey: integrationKeys.sources,
    queryFn: fetchSources,
    staleTime: 5 * 60_000,
  });
}

export function useEmailStatus() {
  return useQuery({
    queryKey: integrationKeys.emailStatus,
    queryFn: fetchEmailStatus,
    staleTime: 5 * 60_000,
  });
}

export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => syncSource(id),
    // A sync creates tickets — refresh the ticket lists/dashboard afterwards.
    onSuccess: () => qc.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}
