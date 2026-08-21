import { describe, it, expect } from "vitest";
import {
  SLA_ACTIVE_STATUSES,
  SLA_DANGER_MS,
  SLA_POLICY,
  SLA_WARN_MS,
  computeDueAt,
  deriveSla,
  slaAlertKind,
} from "./sla";

const H = 3_600_000;
const now = new Date("2026-07-10T12:00:00.000Z");
const inHours = (h: number) => new Date(now.getTime() + h * H);

describe("computeDueAt", () => {
  it("adds the priority policy hours to createdAt", () => {
    expect(computeDueAt("high", now).getTime() - now.getTime()).toBe(
      SLA_POLICY.high * H,
    );
  });

  it("critical is the tightest target, low the loosest", () => {
    expect(SLA_POLICY.critical).toBeLessThan(SLA_POLICY.high);
    expect(SLA_POLICY.high).toBeLessThan(SLA_POLICY.medium);
    expect(SLA_POLICY.medium).toBeLessThan(SLA_POLICY.low);
  });
});

describe("deriveSla", () => {
  it("keeps counting while pending, and can breach there", () => {
    // The spec has no paused clock: `due_at` is set once at creation and never
    // moved, so waiting on the requester spends the target like any other hour.
    // Reporting "paused" here hid an overdue ticket behind a calm badge.
    expect(deriveSla("pending", inHours(0.5), now)).toEqual({
      slaDue: "0h 30m",
      slaState: "danger",
    });
    expect(deriveSla("pending", inHours(2), now).slaState).toBe("warn");
    expect(deriveSla("pending", inHours(6), now).slaState).toBe("ok");
    // Already past the target while still waiting on the requester.
    expect(deriveSla("pending", inHours(-3), now).slaState).toBe("danger");
  });

  it("marks a resolved/closed ticket met when resolved on or before due", () => {
    // due in 2h, resolved at 1h → met
    expect(deriveSla("resolved", inHours(2), now, inHours(1))).toEqual({
      slaDue: "met",
      slaState: "met",
    });
    expect(deriveSla("closed", inHours(2), now, inHours(1))).toEqual({
      slaDue: "met",
      slaState: "met",
    });
  });

  it("marks a late resolution as breached", () => {
    // due at 1h, resolved at 3h → breached
    expect(deriveSla("resolved", inHours(1), now, inHours(3))).toEqual({
      slaDue: "breached",
      slaState: "danger",
    });
  });

  it("falls back to met when there is no target or no resolution time", () => {
    expect(deriveSla("resolved", null, now, inHours(1))).toEqual({
      slaDue: "met",
      slaState: "met",
    });
    expect(deriveSla("closed", inHours(2), now, null)).toEqual({
      slaDue: "met",
      slaState: "met",
    });
  });

  it("shows — / ok for an active ticket with no due date", () => {
    expect(deriveSla("open", null, now)).toEqual({
      slaDue: "—",
      slaState: "ok",
    });
  });

  it("colours active tickets by time remaining", () => {
    expect(deriveSla("open", inHours(0.5), now).slaState).toBe("danger"); // <1h
    expect(deriveSla("open", inHours(2), now).slaState).toBe("warn"); // <4h
    expect(deriveSla("in_progress", inHours(10), now).slaState).toBe("ok"); // ≥4h
  });

  it("formats remaining as Xh Ym under a day, Xd Yh over", () => {
    expect(deriveSla("open", inHours(2), now).slaDue).toBe("2h 0m");
    expect(deriveSla("open", inHours(52), now).slaDue).toBe("2d 4h");
  });

  it("clamps an overdue ticket to zero and flags danger", () => {
    expect(deriveSla("open", inHours(-1), now)).toEqual({
      slaDue: "0h 0m",
      slaState: "danger",
    });
  });
});

describe("slaAlertKind", () => {
  it("says nothing for a comfortable clock", () => {
    expect(slaAlertKind(inHours(10), now)).toBeNull();
  });

  it("says nothing when there is no due date", () => {
    expect(slaAlertKind(null, now)).toBeNull();
  });

  it("warns inside the warn window", () => {
    expect(slaAlertKind(inHours(3), now)).toBe("warning");
    expect(slaAlertKind(inHours(0.5), now)).toBe("warning");
  });

  it("reports a breach at and past the due time", () => {
    expect(slaAlertKind(now, now)).toBe("breach");
    expect(slaAlertKind(inHours(-2), now)).toBe("breach");
  });

  // The boundary is what the sweep's horizon query is built from, so pin it.
  it("treats exactly the warn threshold as a warning", () => {
    const atThreshold = new Date(now.getTime() + SLA_WARN_MS);
    expect(slaAlertKind(atThreshold, now)).toBe("warning");
    expect(slaAlertKind(new Date(atThreshold.getTime() + 1), now)).toBeNull();
  });

  // deriveSla and slaAlertKind must agree about what "at risk" means — one set
  // of thresholds, two consumers.
  it("aligns with the badge deriveSla shows", () => {
    for (const hours of [-1, 0.5, 2, 3.9, 5, 10]) {
      const dueAt = inHours(hours);
      const badge = deriveSla("open", dueAt, now).slaState;
      const alert = slaAlertKind(dueAt, now);
      expect(alert != null).toBe(badge === "warn" || badge === "danger");
    }
  });

  it("keeps danger tighter than warn", () => {
    expect(SLA_DANGER_MS).toBeLessThan(SLA_WARN_MS);
  });
});

describe("SLA_ACTIVE_STATUSES", () => {
  // A finished ticket must never raise an alert; the sweep relies on this list
  // rather than repeating the status logic in a query.
  it("excludes the finished statuses and nothing else", () => {
    expect(SLA_ACTIVE_STATUSES).not.toContain("resolved");
    expect(SLA_ACTIVE_STATUSES).not.toContain("closed");
  });

  it("includes pending, whose clock keeps running", () => {
    // Matches the spec's sweep index, `WHERE status NOT IN ('resolved','closed')`.
    // Omitting it let a ticket parked on the requester breach in silence.
    expect(SLA_ACTIVE_STATUSES).toContain("pending");
  });

  it("covers every status whose clock deriveSla treats as running", () => {
    for (const status of SLA_ACTIVE_STATUSES) {
      expect(deriveSla(status, inHours(2), now).slaState).toBe("warn");
    }
  });
});
