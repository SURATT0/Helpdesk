import { describe, expect, it } from "vitest";
import { displayStatus, type TicketStatusRecord } from "./domain";

const ticket = (
  status: TicketStatusRecord,
  assigneeId: number | null = null,
) => ({
  status,
  assigneeId,
});

describe("displayStatus", () => {
  it("separates New from In Progress by whether anyone has taken it", () => {
    expect(displayStatus(ticket("new"))).toBe("new");
    expect(displayStatus(ticket("new", 7))).toBe("in_progress");
  });

  it("keeps pending and closed as they are, assigned or not", () => {
    expect(displayStatus(ticket("pending"))).toBe("pending");
    expect(displayStatus(ticket("pending", 7))).toBe("pending");
    expect(displayStatus(ticket("closed"))).toBe("closed");
    expect(displayStatus(ticket("closed", 7))).toBe("closed");
  });

  it("reads the pre-migration vocabulary the way it was meant", () => {
    // These three stop being storable when the column narrows, but rows written
    // before that still have to render — and render as what they meant.
    expect(displayStatus(ticket("open"))).toBe("new");
    expect(displayStatus(ticket("open", 7))).toBe("in_progress");
    expect(displayStatus(ticket("resolved"))).toBe("pending");
    // An in_progress row with nobody on it is the anomaly the derived state
    // makes impossible; while it exists, it still reads as In Progress.
    expect(displayStatus(ticket("in_progress"))).toBe("in_progress");
    expect(displayStatus(ticket("in_progress", 7))).toBe("in_progress");
  });
});
