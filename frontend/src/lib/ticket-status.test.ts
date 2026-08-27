import { describe, expect, it } from "vitest";
import {
  DB_STATUSES,
  DISPLAY_STATUSES,
  FINISHED_STATUSES,
  HISTORY_STATUSES,
  STATUS_META,
  STATUS_TRANSITIONS,
  getDisplayStatus,
  isFinished,
} from "./ticket-status";

describe("the three vocabularies", () => {
  it("stores three values and shows four", () => {
    expect(DB_STATUSES).toEqual(["new", "pending", "closed"]);
    expect(DISPLAY_STATUSES).toEqual(["new", "in_progress", "pending", "closed"]);
  });

  it("keeps every stored value showable", () => {
    for (const s of DB_STATUSES) {
      expect(HISTORY_STATUSES, s).toContain(s);
      expect(STATUS_META[s], s).toBeDefined();
    }
  });

  it("has a badge for every word that can reach a badge", () => {
    for (const s of [...DISPLAY_STATUSES, ...HISTORY_STATUSES]) {
      expect(STATUS_META[s], s).toBeDefined();
    }
  });

  it("shows the display list in flow order", () => {
    // The board columns, the filter facet and the table's sort all read this
    // array, so its order is the flow a person is shown.
    expect(DISPLAY_STATUSES.indexOf("new")).toBeLessThan(
      DISPLAY_STATUSES.indexOf("in_progress"),
    );
    expect(DISPLAY_STATUSES.indexOf("in_progress")).toBeLessThan(
      DISPLAY_STATUSES.indexOf("pending"),
    );
    expect(DISPLAY_STATUSES.indexOf("pending")).toBeLessThan(
      DISPLAY_STATUSES.indexOf("closed"),
    );
  });
});

describe("getDisplayStatus", () => {
  it("separates New from In Progress on the assignee alone", () => {
    expect(getDisplayStatus({ status: "new", assigneeId: null })).toBe("new");
    expect(getDisplayStatus({ status: "new", assigneeId: 7 })).toBe("in_progress");
  });

  it("maps the historical words onto what is shown today", () => {
    expect(getDisplayStatus({ status: "open", assigneeId: null })).toBe("new");
    expect(getDisplayStatus({ status: "open", assigneeId: 7 })).toBe("in_progress");
    expect(getDisplayStatus({ status: "resolved", assigneeId: 7 })).toBe("pending");
    expect(getDisplayStatus({ status: "in_progress", assigneeId: null })).toBe(
      "in_progress",
    );
  });

  it("ignores the assignee once the ticket has left the queue", () => {
    expect(getDisplayStatus({ status: "pending", assigneeId: null })).toBe("pending");
    expect(getDisplayStatus({ status: "closed", assigneeId: 7 })).toBe("closed");
  });
});

/**
 * `isFinished` is the one place that says "the desk's work is over", which the
 * SLA judge asks before deciding between a verdict and a countdown. It used to
 * be an inline `status === "pending" || status === "closed"` in sla.ts.
 */
describe("isFinished", () => {
  it("counts pending, because resolved_at is stamped there", () => {
    expect(isFinished("pending")).toBe(true);
    expect(isFinished("closed")).toBe(true);
  });

  it("does not count a ticket still on the desk", () => {
    expect(isFinished("new")).toBe(false);
    expect(isFinished("open")).toBe(false);
    expect(isFinished("in_progress")).toBe(false);
  });

  it("counts the historical `resolved`, which pending replaced", () => {
    expect(isFinished("resolved")).toBe(true);
  });

  it("agrees with FINISHED_STATUSES on the stored words", () => {
    for (const s of DB_STATUSES) {
      expect(isFinished(s), s).toBe(
        (FINISHED_STATUSES as readonly string[]).includes(s),
      );
    }
  });
});

describe("STATUS_TRANSITIONS", () => {
  it("covers every stored status and names only stored ones", () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...DB_STATUSES].sort());
    for (const targets of Object.values(STATUS_TRANSITIONS)) {
      for (const t of targets) expect(DB_STATUSES).toContain(t);
    }
  });

  it("lets a closed ticket reopen, and never sits still", () => {
    expect(STATUS_TRANSITIONS.closed).toEqual(["new"]);
    for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
      expect(targets, from).not.toContain(from);
    }
  });
});
