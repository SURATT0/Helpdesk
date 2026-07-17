import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../shared/auth";

/**
 * Row-level ticket visibility as a Prisma where-clause — the single source of
 * truth for "which tickets can this user see". Used by the ticket repository
 * AND the dashboard/reports aggregates so all three enforce the identical
 * scope and can never drift apart.
 *
 * requester → own tickets; agent → own + their team's queue; manager → own +
 * any team in their department; admin → everything. A ticket's owning team is
 * its assignee's team, or (when unassigned) the team its category routes to.
 */
export function ticketScopeWhere(user: AuthUser): Prisma.TicketWhereInput {
  switch (user.role) {
    case "admin":
      return {};
    case "manager":
      if (!user.department) return { requesterId: user.id };
      return {
        OR: [
          { requesterId: user.id },
          { assignee: { team: { department: user.department } } },
          {
            assigneeId: null,
            category: { defaultTeam: { department: user.department } },
          },
          // General unassigned queue: tickets not routed to any team.
          { assigneeId: null, category: { defaultTeamId: null } },
        ],
      };
    case "agent":
      if (user.teamId == null) return { requesterId: user.id };
      return {
        OR: [
          { requesterId: user.id },
          { assignee: { teamId: user.teamId } },
          { assigneeId: null, category: { defaultTeamId: user.teamId } },
          // General unassigned queue: tickets not routed to any team.
          { assigneeId: null, category: { defaultTeamId: null } },
        ],
      };
    case "requester":
    default:
      return { requesterId: user.id };
  }
}
