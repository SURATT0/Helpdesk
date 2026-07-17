import { apiRequest } from "@/lib/api-client";
import { dashboardSummarySchema, type DashboardSummary } from "./schemas";

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const body = await apiRequest("/dashboard/summary");
  return dashboardSummarySchema.parse(body).data;
}
