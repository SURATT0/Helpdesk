import { describe, expect, it } from "vitest";
import {
  PRIORITIES,
  PRIORITIES_ASCENDING,
  PRIORITY_META,
  isInternalThread,
} from "./domain";

/**
 * Priority was declared in four components in TWO orders, so the same menu read
 * top-down differently on Create Ticket than on the filter bar. One list now,
 * with the other direction named rather than retyped.
 */
describe("PRIORITIES", () => {
  it("runs most urgent first", () => {
    expect(PRIORITIES).toEqual(["critical", "high", "medium", "low"]);
  });

  it("is exactly reversed by PRIORITIES_ASCENDING", () => {
    expect(PRIORITIES_ASCENDING).toEqual([...PRIORITIES].reverse());
  });

  it("does not let the reversal share an array with the original", () => {
    // `.reverse()` mutates in place, so building the ascending list from the
    // canonical one without a copy would silently reverse the canonical one.
    expect(PRIORITIES[0]).toBe("critical");
  });

  it("has a meta entry per priority, in the same order", () => {
    expect(Object.keys(PRIORITY_META)).toEqual([...PRIORITIES]);
  });
});

describe("isInternalThread", () => {
  it("is keyed on the requester having an external side", () => {
    expect(isInternalThread("user")).toBe(false);
    expect(isInternalThread("admin")).toBe(true);
    expect(isInternalThread("super_admin")).toBe(true);
  });
});
