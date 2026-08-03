import { describe, expect, it } from "vitest";
import {
  announcesWorkaround,
  hasWorkaround,
  nextProblemState,
  validateProblemState,
  type ProblemState,
} from "./problem.rules";

const state = (over: Partial<ProblemState> = {}): ProblemState => ({
  status: "investigating",
  workaround: null,
  ...over,
});

describe("nextProblemState", () => {
  it("keeps stored values for fields the patch omits", () => {
    const current = state({ status: "investigating", workaround: "Reboot it" });
    expect(nextProblemState(current, { status: "known_error" })).toEqual({
      status: "known_error",
      workaround: "Reboot it",
    });
  });

  // The distinction that makes clearing a field possible at all.
  it("treats an explicit null as a clear, not as absent", () => {
    const current = state({ workaround: "Reboot it" });
    expect(nextProblemState(current, { workaround: null }).workaround).toBeNull();
  });

  it("leaves everything alone for an empty patch", () => {
    const current = state({ status: "resolved", workaround: "x" });
    expect(nextProblemState(current, {})).toEqual(current);
  });
});

describe("hasWorkaround", () => {
  it("rejects null, empty, and whitespace-only", () => {
    expect(hasWorkaround(state({ workaround: null }))).toBe(false);
    expect(hasWorkaround(state({ workaround: "" }))).toBe(false);
    expect(hasWorkaround(state({ workaround: "   \n\t " }))).toBe(false);
  });

  it("accepts real text", () => {
    expect(hasWorkaround(state({ workaround: "Use the web client" }))).toBe(true);
  });
});

describe("validateProblemState", () => {
  // The rule that makes "known error" mean something rather than being a label.
  it("refuses known_error without a workaround", () => {
    expect(validateProblemState(state({ status: "known_error" }))).toMatch(
      /workaround/i,
    );
  });

  it("refuses known_error with a whitespace-only workaround", () => {
    expect(
      validateProblemState(state({ status: "known_error", workaround: "  " })),
    ).toMatch(/workaround/i);
  });

  it("allows known_error once a workaround exists", () => {
    expect(
      validateProblemState(
        state({ status: "known_error", workaround: "Use the web client" }),
      ),
    ).toBeNull();
  });

  it("does not require a workaround for any other status", () => {
    for (const status of ["investigating", "resolved", "closed"] as const) {
      expect(validateProblemState(state({ status }))).toBeNull();
    }
  });

  // Deliberately not a transition whitelist — unlike ticket statuses, the problem
  // lifecycle has no documented order, so every path stays open.
  it("permits any status transition", () => {
    const statuses = ["investigating", "resolved", "closed"] as const;
    for (const from of statuses) {
      for (const to of statuses) {
        const next = nextProblemState(state({ status: from }), { status: to });
        expect(validateProblemState(next)).toBeNull();
      }
    }
  });
});

describe("announcesWorkaround", () => {
  it("announces on the transition into known_error", () => {
    const current = state({ status: "investigating" });
    const next = state({ status: "known_error", workaround: "Use the web client" });
    expect(announcesWorkaround(current, next)).toBe(true);
  });

  // Fixing a typo in an existing workaround must not re-notify everyone.
  it("stays quiet when it was already a known error", () => {
    const current = state({ status: "known_error", workaround: "old text" });
    const next = state({ status: "known_error", workaround: "clearer text" });
    expect(announcesWorkaround(current, next)).toBe(false);
  });

  it("stays quiet for other statuses", () => {
    const current = state({ status: "investigating" });
    expect(
      announcesWorkaround(current, state({ status: "resolved", workaround: "x" })),
    ).toBe(false);
  });

  it("cannot announce without an actual workaround", () => {
    // Unreachable through the service (validate rejects it first), but the rule
    // must not depend on that ordering.
    const current = state({ status: "investigating" });
    const next = state({ status: "known_error", workaround: null });
    expect(announcesWorkaround(current, next)).toBe(false);
  });
});
