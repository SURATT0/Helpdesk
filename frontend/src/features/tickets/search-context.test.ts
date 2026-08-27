import { describe, expect, it } from "vitest";
import { matchesFilters, matchesQuery, type AssigneeKey } from "./search-context";
import type { DisplayStatus, Priority, TicketStatus } from "@/lib/domain";

const ticket = (over: Partial<Parameters<typeof matchesFilters>[0]> = {}) => ({
  id: 1042,
  subject: "VPN drops every 10 minutes",
  requester: "Marcus Chen",
  status: "new" as TicketStatus,
  // Assigned and unfinished, so what the row shows is In Progress — the facet
  // filters on this, the SLA judgement on `status`.
  displayStatus: "in_progress" as DisplayStatus,
  priority: "high" as Priority,
  assignee: "Dana Reyes",
  assigneeId: 7,
  ...over,
});

const filters = (over: Partial<{
  query: string;
  statuses: Set<DisplayStatus>;
  priorities: Set<Priority>;
  assignees: Set<AssigneeKey>;
}> = {}) => ({
  query: "",
  statuses: new Set<DisplayStatus>(),
  priorities: new Set<Priority>(),
  assignees: new Set<AssigneeKey>(),
  ...over,
});

describe("matchesQuery", () => {
  it("matches on subject, id, and requester, case-insensitively", () => {
    expect(matchesQuery(ticket(), "vpn")).toBe(true);
    expect(matchesQuery(ticket(), "1042")).toBe(true);
    expect(matchesQuery(ticket(), "marcus")).toBe(true);
    expect(matchesQuery(ticket(), "printer")).toBe(false);
  });

  it("treats an empty or whitespace query as no filter", () => {
    expect(matchesQuery(ticket(), "")).toBe(true);
    expect(matchesQuery(ticket(), "   ")).toBe(true);
  });
});

describe("matchesFilters — assignee facet", () => {
  // The distinction that makes the facet correct: selecting nothing means "no
  // assignee filter", which is NOT the same as selecting "Unassigned".
  it("passes everything when no assignee is selected", () => {
    expect(matchesFilters(ticket(), filters())).toBe(true);
    expect(matchesFilters(ticket({ assigneeId: null }), filters())).toBe(true);
  });

  it("matches a selected assignee by id", () => {
    const f = filters({ assignees: new Set<AssigneeKey>([7]) });
    expect(matchesFilters(ticket({ assigneeId: 7 }), f)).toBe(true);
    expect(matchesFilters(ticket({ assigneeId: 9 }), f)).toBe(false);
  });

  it("only matches unassigned tickets on an explicit 'none' selection", () => {
    const none = filters({ assignees: new Set<AssigneeKey>(["none"]) });
    expect(matchesFilters(ticket({ assigneeId: null }), none)).toBe(true);
    expect(matchesFilters(ticket({ assigneeId: 7 }), none)).toBe(false);

    const someone = filters({ assignees: new Set<AssigneeKey>([7]) });
    expect(matchesFilters(ticket({ assigneeId: null }), someone)).toBe(false);
  });

  it("ORs multiple selections, including 'none' alongside a person", () => {
    const f = filters({ assignees: new Set<AssigneeKey>([7, "none"]) });
    expect(matchesFilters(ticket({ assigneeId: 7 }), f)).toBe(true);
    expect(matchesFilters(ticket({ assigneeId: null }), f)).toBe(true);
    expect(matchesFilters(ticket({ assigneeId: 9 }), f)).toBe(false);
  });

  // Keying on id rather than display name is the point: two people can share a
  // name, and filtering by name would merge their queues.
  it("does not confuse two assignees who share a display name", () => {
    const f = filters({ assignees: new Set<AssigneeKey>([7]) });
    const sameName = ticket({ assigneeId: 9, assignee: "Dana Reyes" });
    expect(matchesFilters(sameName, f)).toBe(false);
  });
});

describe("matchesFilters — facets combine", () => {
  it("ANDs across facets", () => {
    const t = ticket({ assigneeId: 7, displayStatus: "in_progress", priority: "high" });
    expect(
      matchesFilters(
        t,
        filters({
          statuses: new Set<DisplayStatus>(["in_progress"]),
          priorities: new Set<Priority>(["high"]),
          assignees: new Set<AssigneeKey>([7]),
        }),
      ),
    ).toBe(true);

    // One mismatching facet is enough to exclude.
    expect(
      matchesFilters(
        t,
        filters({
          statuses: new Set<DisplayStatus>(["in_progress"]),
          priorities: new Set<Priority>(["low"]),
          assignees: new Set<AssigneeKey>([7]),
        }),
      ),
    ).toBe(false);
  });

  it("ORs within a facet", () => {
    const f = filters({
      statuses: new Set<DisplayStatus>(["new", "in_progress"]),
    });
    expect(matchesFilters(ticket({ displayStatus: "new" }), f)).toBe(true);
    expect(matchesFilters(ticket({ displayStatus: "in_progress" }), f)).toBe(true);
    expect(matchesFilters(ticket({ displayStatus: "closed" }), f)).toBe(false);
  });

  it("still applies the free-text query alongside facets", () => {
    const f = filters({
      query: "printer",
      assignees: new Set<AssigneeKey>([7]),
    });
    expect(matchesFilters(ticket({ assigneeId: 7 }), f)).toBe(false);
  });
});
