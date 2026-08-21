import { describe, expect, it } from "vitest";
import { canSeeReporting, landingFor, REPORTING_ROLES } from "./landing";

describe("landingFor", () => {
  it("sends staff to the dashboard", () => {
    expect(landingFor("admin")).toBe("/dashboard");
    expect(landingFor("super_admin")).toBe("/dashboard");
  });

  it("sends a requester to their tickets instead", () => {
    // The dashboard is behind `dashboard:read` now, so the old unconditional
    // redirect would have landed them on a 403 as the first thing after login.
    expect(landingFor("user")).toBe("/tickets");
  });

  it("treats an unknown role as the narrower case", () => {
    // Reached while the session bootstrap is still running. Guessing the
    // privileged page and correcting afterwards would flash it.
    expect(landingFor(undefined)).toBe("/tickets");
  });
});

describe("canSeeReporting", () => {
  it("matches the roles the API grants report:read to", () => {
    expect(canSeeReporting("admin")).toBe(true);
    expect(canSeeReporting("super_admin")).toBe(true);
    expect(canSeeReporting("user")).toBe(false);
    expect(canSeeReporting(undefined)).toBe(false);
  });

  it("agrees with the list the sidebar filters on", () => {
    // One source for the nav entry and the page guard; two would drift.
    for (const role of REPORTING_ROLES) expect(canSeeReporting(role)).toBe(true);
    expect(REPORTING_ROLES).not.toContain("user");
  });

  it("lands everyone it admits on the dashboard", () => {
    for (const role of REPORTING_ROLES) expect(landingFor(role)).toBe("/dashboard");
  });
});
