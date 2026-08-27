import { describe, expect, it } from "vitest";
import {
  DISPLAY_STATUSES,
  getDisplayStatus,
  toQueryFilter,
  type TicketStatusRecord,
} from "./ticket-status";

const ticket = (
  status: TicketStatusRecord,
  assigneeId: number | null = null,
) => ({
  status,
  assigneeId,
});

describe("getDisplayStatus", () => {
  it("separates New from In Progress by whether anyone has taken it", () => {
    expect(getDisplayStatus(ticket("new"))).toBe("new");
    expect(getDisplayStatus(ticket("new", 7))).toBe("in_progress");
  });

  it("keeps pending and closed as they are, assigned or not", () => {
    expect(getDisplayStatus(ticket("pending"))).toBe("pending");
    expect(getDisplayStatus(ticket("pending", 7))).toBe("pending");
    expect(getDisplayStatus(ticket("closed"))).toBe("closed");
    expect(getDisplayStatus(ticket("closed", 7))).toBe("closed");
  });

  it("reads the pre-migration vocabulary the way it was meant", () => {
    // These three stop being storable when the column narrows, but rows written
    // before that still have to render — and render as what they meant.
    expect(getDisplayStatus(ticket("open"))).toBe("new");
    expect(getDisplayStatus(ticket("open", 7))).toBe("in_progress");
    expect(getDisplayStatus(ticket("resolved"))).toBe("pending");
    // An in_progress row with nobody on it is the anomaly the derived state
    // makes impossible; while it exists, it still reads as In Progress.
    expect(getDisplayStatus(ticket("in_progress"))).toBe("in_progress");
    expect(getDisplayStatus(ticket("in_progress", 7))).toBe("in_progress");
  });
});

describe("toQueryFilter", () => {
  it("gives each display status the clause the spec names", () => {
    expect(toQueryFilter("new")).toEqual({ status: "new", assigneeId: null });
    expect(toQueryFilter("in_progress")).toEqual({
      status: "new",
      assigneeId: { not: null },
    });
    expect(toQueryFilter("pending")).toEqual({ status: "pending" });
    expect(toQueryFilter("closed")).toEqual({ status: "closed" });
  });

  it("partitions every ticket: each matches exactly one filter", () => {
    // The property that makes a set of facets trustworthy — no ticket lost
    // between two filters, none counted by both. Checked against the clause
    // rather than the database, so it holds before any row exists.
    const matches = (
      clause: Record<string, unknown>,
      ticket: { status: string; assigneeId: number | null },
    ) => {
      if (clause.status !== ticket.status) return false;
      if (!("assigneeId" in clause)) return true;
      return clause.assigneeId === null
        ? ticket.assigneeId === null
        : ticket.assigneeId !== null;
    };

    const everyShape = [
      { status: "new", assigneeId: null },
      { status: "new", assigneeId: 7 },
      { status: "pending", assigneeId: null },
      { status: "pending", assigneeId: 7 },
      { status: "closed", assigneeId: null },
      { status: "closed", assigneeId: 7 },
    ];

    for (const ticket of everyShape) {
      const hits = DISPLAY_STATUSES.filter((s) =>
        matches(toQueryFilter(s) as Record<string, unknown>, ticket),
      );
      expect(hits).toHaveLength(1);
      // And the one it matches is the one it is shown as.
      expect(hits[0]).toBe(
        getDisplayStatus(ticket as Parameters<typeof getDisplayStatus>[0]),
      );
    }
  });
});
