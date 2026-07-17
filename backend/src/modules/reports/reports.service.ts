import type { AuthUser } from "../../shared/auth";
import { reportsRepository, type ReportsSummary } from "./reports.repository";

export const reportsService = {
  slaSummary(user: AuthUser): Promise<ReportsSummary> {
    return reportsRepository.getSlaSummary(new Date(), user);
  },
};
