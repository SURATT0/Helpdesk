import { describe, expect, it } from "vitest";
import { reportsToCsv, workloadToCsv } from "./export";
import type { ReportsSummary } from "./schemas";

/**
 * What ends up in the FILE, not what ends up on screen.
 *
 * A CSV is the artefact that leaves the building — it gets mailed, dropped in a
 * shared drive, opened months later. Hiding a column in the preview and writing
 * it to disk anyway is the failure mode these tests exist to catch, so they
 * assert on the exported string itself.
 */
const summary: ReportsSummary = {
  kpis: {
    avgHandlingHours: 56.1,
    medianFirstResponseMin: 252,
    slaCompliancePct: 55.9,
    handledCount: 24,
    judgedCount: 34,
  },
  closureTrend: [
    { day: "2026-08-27", count: 14 },
    { day: "2026-08-28", count: 0 },
  ],
  byPriority: [
    { priority: "critical", compliancePct: 40, met: 2, breached: 3 },
  ],
  byCategory: [
    { category: "Access", judged: 9, met: 7, breached: 2, compliancePct: 77.8 },
  ],
};

describe("reportsToCsv", () => {
  const csv = reportsToCsv(summary, ["Aug 27", "Aug 28"]);

  it("names no person and writes no per-agent section", () => {
    expect(csv).not.toContain("Agent");
    expect(csv).not.toContain("Avg resolution");
    expect(csv).not.toContain("Dana Reyes");
  });

  it("is not merely missing the header — there is no agent row shape at all", () => {
    // The old document ended with `Dana Reyes,9,38.9`. Nothing in this file may
    // pair a name with two figures.
    const rows = csv.split("\r\n").map((r) => r.split(","));
    const nameLike = rows.filter(
      (cells) => cells.length === 3 && /^[A-Z][a-z]+ /.test(cells[0] ?? ""),
    );
    expect(nameLike).toEqual([]);
  });

  it("still carries every team-wide section it always did", () => {
    expect(csv).toContain("SLA compliance (%)");
    expect(csv).toContain("Avg handling time, opened to closed (h)");
    expect(csv).toContain("Tickets closed");
    expect(csv).toContain("Priority,Compliance (%),Met,Breached");
    expect(csv).toContain("Category,Compliance (%),Judged,Breached");
    expect(csv).toContain("Access,77.8,9,2");
  });
});

describe("workloadToCsv", () => {
  it("writes the per-agent table — the export that lives behind the gate", () => {
    const csv = workloadToCsv([
      { agentId: 1, agent: "Dana Reyes", handled: 9, avgHandlingHours: 38.9 },
      { agentId: 4, agent: "Ana M.", handled: 7, avgHandlingHours: 51.2 },
    ]);
    expect(csv).toContain("Agent,Resolved,Avg resolution (h)");
    expect(csv).toContain("Dana Reyes,9,38.9");
    // The id is the join key, not something a reader of the file needs.
    expect(csv).not.toContain("agentId");
  });

  it("quotes a name containing a comma, like every other cell", () => {
    const csv = workloadToCsv([
      { agentId: 2, agent: "Lee, Morgan", handled: 1, avgHandlingHours: 2 },
    ]);
    expect(csv).toContain('"Lee, Morgan",1,2');
  });
});
