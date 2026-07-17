import { describe, it, expect } from "vitest";
import { SLA_POLICY, computeDueAt, deriveSla } from "./sla";

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
  it("pauses the clock while pending", () => {
    expect(deriveSla("pending", inHours(1), now)).toEqual({
      slaDue: "paused",
      slaState: "paused",
    });
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
