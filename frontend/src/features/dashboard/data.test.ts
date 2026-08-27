import { describe, expect, it } from "vitest";
import { PRIORITY_META, type Priority } from "@/lib/domain";
import { DISPLAY_STATUSES, STATUS_META } from "@/lib/ticket-status";
import { PRIORITY_CHART, STATUS_CHART, conicGradient } from "./data";

/**
 * A chart is a second rendering of a badge, so it may not pick its own colours.
 *
 * These two records used to be a hand-written second palette, and every entry
 * had drifted from the badge beside it — Pending was #6d28d9 in its badge and
 * #8b5cf6 in the bar, Closed #475569 and #cbd5e1. Nothing failed, because
 * nothing compared them.
 */
describe("chart colours", () => {
  it("gives every shown status the colour of its badge", () => {
    for (const status of DISPLAY_STATUSES) {
      expect(STATUS_CHART[status].color, status).toBe(STATUS_META[status].fg);
    }
  });

  it("covers every shown status and nothing else", () => {
    expect(Object.keys(STATUS_CHART).sort()).toEqual([...DISPLAY_STATUSES].sort());
  });

  it("gives every priority the colour of its dot", () => {
    for (const p of Object.keys(PRIORITY_META) as Priority[]) {
      expect(PRIORITY_CHART[p].color, p).toBe(PRIORITY_META[p].dot);
    }
  });

  it("covers every priority", () => {
    expect(Object.keys(PRIORITY_CHART).sort()).toEqual(
      Object.keys(PRIORITY_META).sort(),
    );
  });

  it("gives two statuses different colours", () => {
    // Guards the derivation itself: reading one field for every entry would
    // satisfy the assertions above while painting the whole chart one colour.
    expect(STATUS_CHART.new.color).not.toBe(STATUS_CHART.closed.color);
  });
});

describe("conicGradient", () => {
  it("lays slices end to end as percentages", () => {
    expect(
      conicGradient([
        { value: 1, color: "#a" },
        { value: 3, color: "#b" },
      ]),
    ).toBe("conic-gradient(#a 0% 25%,#b 25% 100%)");
  });

  it("survives an all-zero donut without dividing by zero", () => {
    expect(conicGradient([{ value: 0, color: "#a" }])).toBe(
      "conic-gradient(#a 0% 0%)",
    );
  });
});
