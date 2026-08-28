import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/context";
import { maySeeTeamWorkload } from "@/lib/permissions";
import { fetchAgentWorkload, fetchReportsSummary } from "./api";

export const reportKeys = {
  summary: ["reports", "sla-summary"] as const,
  agentWorkload: ["reports", "workload", "agents"] as const,
};

export function useReportsSummary() {
  return useQuery({
    queryKey: reportKeys.summary,
    queryFn: fetchReportsSummary,
  });
}

/**
 * The per-agent table, fetched only by someone who may have it.
 *
 * `enabled` here is not a security measure — the server's 403 is — but it does
 * matter: without it every agent's reports page would fire a request that comes
 * back forbidden, and the query would sit in an error state that some future
 * error boundary could well render as "something went wrong" on a page where
 * nothing did.
 */
export function useAgentWorkload() {
  const { user } = useAuth();
  const allowed = maySeeTeamWorkload(user?.role);
  return useQuery({
    queryKey: reportKeys.agentWorkload,
    queryFn: fetchAgentWorkload,
    enabled: allowed,
  });
}
