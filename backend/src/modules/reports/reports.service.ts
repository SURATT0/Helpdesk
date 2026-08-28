import {
  maySeeTeamWorkload,
  maySeeWorkloadOf,
  type AuthUser,
} from "../../shared/auth";
import { Forbidden } from "../../shared/errors";
import {
  reportsRepository,
  type AgentWorkload,
  type ReportsSummary,
} from "./reports.repository";

export const reportsService = {
  slaSummary(user: AuthUser): Promise<ReportsSummary> {
    return reportsRepository.getSlaSummary(new Date(), user);
  },

  /**
   * The table that ranks the desk against itself. Superuser only.
   *
   * Refused rather than emptied: an empty array is a legitimate answer (a desk
   * that has closed nothing), so returning one to a caller who may not ask would
   * make "no data" and "not allowed" the same response, and the client could not
   * tell whether to hide the section or say so.
   */
  async agentWorkload(user: AuthUser): Promise<AgentWorkload[]> {
    if (!maySeeTeamWorkload(user)) {
      throw Forbidden("Agent workload is visible to super admins only");
    }
    return reportsRepository.getAgentWorkload(user);
  },

  /**
   * One person's own throughput — the exception the rule is built around.
   *
   * An absent `assigneeId` means the caller, for everyone: a super admin wanting
   * the whole desk asks `agentWorkload` above. That way this route has no input
   * that returns more than one person, and the only decision left is whether the
   * one person asked for is you.
   */
  async workloadFor(
    user: AuthUser,
    assigneeId?: number,
  ): Promise<AgentWorkload | null> {
    const target = assigneeId ?? user.id;
    if (!maySeeWorkloadOf(user, target)) {
      throw Forbidden("You may only read your own workload");
    }
    const [row] = await reportsRepository.getAgentWorkload(user, target);
    return row ?? null;
  },
};
