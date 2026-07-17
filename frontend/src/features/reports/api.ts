import { apiRequest } from "@/lib/api-client";
import { reportsSummarySchema, type ReportsSummary } from "./schemas";

export async function fetchReportsSummary(): Promise<ReportsSummary> {
  const body = await apiRequest("/reports/sla-summary");
  return reportsSummarySchema.parse(body).data;
}
