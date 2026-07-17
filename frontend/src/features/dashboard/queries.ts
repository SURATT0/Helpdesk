import { useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary } from "./api";

export const dashboardKeys = {
  summary: ["dashboard", "summary"] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: fetchDashboardSummary,
  });
}
