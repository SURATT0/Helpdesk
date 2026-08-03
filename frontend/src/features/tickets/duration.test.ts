import { describe, it, expect } from "vitest";
import { formatDuration, openDuration, type DurationLabels } from "./duration";

const L: DurationLabels = { d: "d", h: "h", m: "m" };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatDuration", () => {
  it("floors sub-minute spans rather than showing 0m", () => {
    expect(formatDuration(0, L)).toBe("<1m");
    expect(formatDuration(59_999, L)).toBe("<1m");
  });

  it("shows minutes under an hour", () => {
    expect(formatDuration(MIN, L)).toBe("1m");
    expect(formatDuration(45 * MIN, L)).toBe("45m");
    expect(formatDuration(HOUR - 1, L)).toBe("59m");
  });

  it("shows hours and minutes under a day", () => {
    expect(formatDuration(2 * HOUR + 10 * MIN, L)).toBe("2h 10m");
    expect(formatDuration(DAY - MIN, L)).toBe("23h 59m");
  });

  it("drops a zero minute part", () => {
    expect(formatDuration(2 * HOUR, L)).toBe("2h");
  });

  it("shows days and hours beyond a day", () => {
    expect(formatDuration(DAY + 3 * HOUR, L)).toBe("1d 3h");
    expect(formatDuration(9 * DAY + 23 * HOUR, L)).toBe("9d 23h");
  });

  it("drops a zero hour part", () => {
    expect(formatDuration(3 * DAY, L)).toBe("3d");
  });

  it("never renders minutes alongside days", () => {
    // 1d 0h 45m → "1d", not "1d 45m": two units at most, largest first.
    expect(formatDuration(DAY + 45 * MIN, L)).toBe("1d");
  });

  it("clamps a negative span to zero instead of signing it", () => {
    expect(formatDuration(-5 * MIN, L)).toBe("<1m");
  });

  it("uses the injected unit words", () => {
    const th: DurationLabels = { d: "ว", h: "ชม", m: "น" };
    expect(formatDuration(DAY + 3 * HOUR, th)).toBe("1ว 3ชม");
    expect(formatDuration(25 * MIN, th)).toBe("25น");
  });
});

describe("openDuration", () => {
  it("measures creation to closure", () => {
    expect(
      openDuration("2026-07-31T10:00:00.000Z", "2026-07-31T12:10:00.000Z"),
    ).toBe(2 * HOUR + 10 * MIN);
  });

  it("is null when the ticket is not closed", () => {
    expect(openDuration("2026-07-31T10:00:00.000Z", null)).toBeNull();
  });

  it("is null on an unparseable timestamp", () => {
    expect(openDuration("not a date", "2026-07-31T12:00:00.000Z")).toBeNull();
    expect(openDuration("2026-07-31T10:00:00.000Z", "not a date")).toBeNull();
  });
});
