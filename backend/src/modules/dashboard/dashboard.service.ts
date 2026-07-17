import type { AuthUser } from "../../shared/auth";
import { dashboardRepository, type DashboardSummary } from "./dashboard.repository";

export const dashboardService = {
  summary(user: AuthUser): Promise<DashboardSummary> {
    return dashboardRepository.getSummary(new Date(), user);
  },
};
