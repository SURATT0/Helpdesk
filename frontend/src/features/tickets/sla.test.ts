import { describe, expect, it } from "vitest";
import { assessSla, compareSla, type SlaLabels } from "./sla";
import type { TicketStatus } from "@/lib/domain";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Mirrors the shape the dictionary supplies, with recognisable text. */
const labels: SlaLabels = {
  units: { d: "d", h: "h", m: "m" },
  over: "{d} over",
  left: "{d} left",
  missed: "missed by {d}",
  paused: "paused",
  met: "met",
  none: "—",
};

const at = (ms: number) => new Date(NOW + ms).toISOString();

function judge(
  over: {
    dueAt?: string | null;
    status?: TicketStatus;
    resolvedAt?: string | null;
  } = {},
) {
  return assessSla(
    {
      dueAt: at(3 * HOUR),
      status: "open",
      resolvedAt: null,
      ...over,
    },
    labels,
    NOW,
  );
}

describe("assessSla — the seven states plus no target", () => {
  it("breached_open: overdue and nobody has closed it", () => {
    expect(judge({ dueAt: at(-(2 * HOUR + 14 * MINUTE)) })).toEqual({
      state: "breached_open",
      minutesDelta: -134,
      label: "2h 14m over",
    });
  });

  it("at_risk: under an hour left", () => {
    expect(judge({ dueAt: at(42 * MINUTE) })).toEqual({
      state: "at_risk",
      minutesDelta: 42,
      label: "42m left",
    });
  });

  it("due_soon: inside the window the server already warns about", () => {
    // The 4h tier is not cosmetic — this is where the backend sweep emails an
    // SLA warning, so it must not render as a calm "on track".
    expect(judge({ dueAt: at(3 * HOUR + 20 * MINUTE) })).toEqual({
      state: "due_soon",
      minutesDelta: 200,
      label: "3h 20m left",
    });
  });

  it("on_track: comfortably ahead", () => {
    expect(judge({ dueAt: at(9 * HOUR) })).toEqual({
      state: "on_track",
      minutesDelta: 540,
      label: "9h left",
    });
  });

  it("paused: pending reports its headroom but stops counting down", () => {
    // The deadline is never actually pushed out for a paused ticket, so the label
    // says "paused" rather than dressing the remaining time up as a countdown.
    expect(judge({ status: "pending", dueAt: at(30 * MINUTE) })).toEqual({
      state: "paused",
      minutesDelta: 30,
      label: "paused",
    });
  });

  it("paused wins even when the deadline has already gone by", () => {
    const p = judge({ status: "pending", dueAt: at(-5 * HOUR) });
    expect(p.state).toBe("paused");
    expect(p.minutesDelta).toBe(-300);
  });

  it("breached_closed: finished, but after the target", () => {
    expect(
      judge({
        status: "closed",
        dueAt: at(-4 * 24 * HOUR),
        resolvedAt: at(-24 * HOUR),
      }),
    ).toEqual({
      state: "breached_closed",
      minutesDelta: -4320,
      label: "missed by 3d",
    });
  });

  it("met: finished on or before the target", () => {
    expect(
      judge({ status: "closed", dueAt: at(-HOUR), resolvedAt: at(-3 * HOUR) }),
    ).toEqual({ state: "met", minutesDelta: 120, label: "met" });
  });

  it("no_sla: a dash, never a made-up zero", () => {
    // The old column showed "0h 0m" here, which read as "out of time".
    expect(judge({ dueAt: null })).toEqual({
      state: "no_sla",
      minutesDelta: null,
      label: "—",
    });
    expect(judge({ dueAt: "not a date" }).state).toBe("no_sla");
  });
});

describe("assessSla — boundaries", () => {
  it("judges a resolved ticket without waiting for it to close", () => {
    // The backend decides met/breached at `resolved`; disagreeing here would put
    // a different verdict on the list than in the reports.
    expect(
      judge({ status: "resolved", dueAt: at(-HOUR), resolvedAt: at(-2 * HOUR) })
        .state,
    ).toBe("met");
    expect(
      judge({ status: "resolved", dueAt: at(-2 * HOUR), resolvedAt: at(-HOUR) })
        .state,
    ).toBe("breached_closed");
  });

  it("counts finishing exactly on the target as met", () => {
    const on = judge({ status: "closed", dueAt: at(-HOUR), resolvedAt: at(-HOUR) });
    expect(on.state).toBe("met");
    expect(on.minutesDelta).toBe(0);
  });

  it("falls back to met when nothing recorded the finish time", () => {
    expect(judge({ status: "closed", resolvedAt: null })).toEqual({
      state: "met",
      minutesDelta: null,
      label: "met",
    });
  });

  it("steps between the tiers exactly at 1h and 4h", () => {
    expect(judge({ dueAt: at(59 * MINUTE) }).state).toBe("at_risk");
    expect(judge({ dueAt: at(HOUR) }).state).toBe("due_soon");
    expect(judge({ dueAt: at(4 * HOUR - MINUTE) }).state).toBe("due_soon");
    expect(judge({ dueAt: at(4 * HOUR) }).state).toBe("on_track");
  });

  it("treats the target passing as breached, not as zero left", () => {
    expect(judge({ dueAt: at(MINUTE) }).state).toBe("at_risk");
    expect(judge({ dueAt: at(-1) }).state).toBe("breached_open");
    // Barely late still says so, in words: "<1m over", never "0h 0m".
    expect(judge({ dueAt: at(-1) }).label).toBe("<1m over");
  });
});

describe("compareSla — worst first", () => {
  it("puts the most overdue open ticket first and the settled ones last", () => {
    const rows = [
      judge({ dueAt: at(9 * HOUR) }), // on_track
      judge({ status: "closed", dueAt: at(-HOUR), resolvedAt: at(-2 * HOUR) }), // met
      judge({ dueAt: at(-30 * MINUTE) }), // breached_open, a little
      judge({ dueAt: null }), // no_sla
      judge({ status: "pending", dueAt: at(HOUR) }), // paused
      judge({ dueAt: at(-5 * HOUR) }), // breached_open, badly
      judge({ dueAt: at(20 * MINUTE) }), // at_risk
      judge({
        status: "closed",
        dueAt: at(-3 * HOUR),
        resolvedAt: at(-HOUR),
      }), // breached_closed
    ];

    expect([...rows].sort(compareSla).map((r) => r.state)).toEqual([
      "breached_open",
      "breached_open",
      "at_risk",
      "on_track",
      "breached_closed",
      "paused",
      "met",
      "no_sla",
    ]);
  });

  it("orders the two breached_open rows by how badly they overran", () => {
    const worse = judge({ dueAt: at(-5 * HOUR) });
    const milder = judge({ dueAt: at(-30 * MINUTE) });
    expect(compareSla(worse, milder)).toBeLessThan(0);
  });
});
