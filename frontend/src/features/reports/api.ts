import { apiRequest } from "@/lib/api-client";
import {
  agentWorkloadSchema,
  reportsSummarySchema,
  type AgentWorkload,
  type ReportsSummary,
} from "./schemas";

export async function fetchReportsSummary(): Promise<ReportsSummary> {
  const body = await apiRequest("/reports/sla-summary");
  return reportsSummarySchema.parse(body).data;
}

/**
 * The desk compared against itself. 403s for anyone but a super admin — the
 * caller is expected not to ask (see `maySeeTeamWorkload`), and the server
 * refusing is what makes that a gate rather than a courtesy.
 */
export async function fetchAgentWorkload(): Promise<AgentWorkload[]> {
  const body = await apiRequest("/reports/workload/agents");
  return agentWorkloadSchema.parse(body).data;
}
