import { useQuery } from "@tanstack/react-query";
import { fetchReportsSummary } from "./api";

export const reportKeys = {
  summary: ["reports", "sla-summary"] as const,
};

export function useReportsSummary() {
  return useQuery({
    queryKey: reportKeys.summary,
    queryFn: fetchReportsSummary,
  });
}
