import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  filtersToSearch,
  formatDay,
  parseDay,
  readFilters,
  type HistoryFilters,
} from "./history-filter-url";
import type { DateRange } from "./date-range";

const d = (y: number, m: number, day: number) => new Date(y, m, day);
const range = (a: Date, b: Date): DateRange => ({ start: a, end: b });
const read = (search: string) => readFilters(new URLSearchParams(search));

describe("formatDay / parseDay", () => {
  it("keeps the local calendar day, not the UTC one", () => {
    // The trap this pair exists to avoid: 20 Aug at local midnight is still
    // 19 Aug in UTC anywhere east of Greenwich, so `toISOString().slice(0, 10)`
    // would send a link that comes back a day early.
    expect(formatDay(d(2026, 7, 20))).toBe("2026-08-20");
    expect(formatDay(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
  });

  it("pads single-digit months and days", () => {
    expect(formatDay(d(2026, 0, 5))).toBe("2026-01-05");
  });

  it("round-trips through parseDay to local midnight", () => {
    const parsed = parseDay("2026-08-20");
    expect(parsed).toEqual(d(2026, 7, 20));
    expect(parsed?.getHours()).toBe(0);
  });

  it("rejects anything that is not a real YYYY-MM-DD", () => {
    for (const bad of [
      null,
      "",
      "2026-8-20", // unpadded
      "20-08-2026", // wrong order
      "2026-13-01", // no thirteenth month
      "2026-02-31", // rolls into March if not checked
      "2026-00-10",
      "not-a-date",
    ]) {
      expect(parseDay(bad)).toBeNull();
    }
  });
});

describe("readFilters", () => {
  it("reads an empty query string as no filters at all", () => {
    expect(read("")).toEqual(EMPTY_FILTERS);
  });

  it("reads each filter on its own", () => {
    expect(read("q=vpn").query).toBe("vpn");
    expect(read("priority=critical").priority).toBe("critical");
    expect(read("from=2026-01-01&to=2026-08-20").range).toEqual(
      range(d(2026, 0, 1), d(2026, 7, 20)),
    );
  });

  it("reads all three together", () => {
    expect(read("q=vpn&priority=high&from=2026-03-01&to=2026-03-31")).toEqual({
      query: "vpn",
      priority: "high",
      range: range(d(2026, 2, 1), d(2026, 2, 31)),
    });
  });

  it("drops a priority it does not recognise", () => {
    // Hand-edited or stale links must not filter on a value the UI cannot show.
    expect(read("priority=urgent").priority).toBe("");
    expect(read("priority=HIGH").priority).toBe("");
  });

  it("ignores a half-written range", () => {
    // One end says nothing about the other, so neither is applied.
    expect(read("from=2026-01-01").range).toBeNull();
    expect(read("to=2026-08-20").range).toBeNull();
  });

  it("ignores a range with an unparseable end", () => {
    expect(read("from=2026-01-01&to=oops").range).toBeNull();
  });

  it("puts a reversed range back in order", () => {
    expect(read("from=2026-08-20&to=2026-01-01").range).toEqual(
      range(d(2026, 0, 1), d(2026, 7, 20)),
    );
  });

  it("trims the search text", () => {
    expect(read("q=%20%20vpn%20%20").query).toBe("vpn");
  });

  it("keeps Thai search text intact", () => {
    expect(read(`q=${encodeURIComponent("ทดสอบ")}`).query).toBe("ทดสอบ");
  });
});

describe("filtersToSearch", () => {
  const filters = (over: Partial<HistoryFilters> = {}): HistoryFilters => ({
    ...EMPTY_FILTERS,
    ...over,
  });

  it("returns nothing when nothing is filtered", () => {
    // An unfiltered log keeps a clean /history in the address bar.
    expect(filtersToSearch(filters())).toBe("");
  });

  it("omits a blank search rather than writing q=", () => {
    expect(filtersToSearch(filters({ query: "   " }))).toBe("");
  });

  it("writes each filter it has", () => {
    expect(filtersToSearch(filters({ query: "vpn" }))).toBe("?q=vpn");
    expect(filtersToSearch(filters({ priority: "low" }))).toBe("?priority=low");
    expect(
      filtersToSearch(filters({ range: range(d(2026, 0, 1), d(2026, 7, 20)) })),
    ).toBe("?from=2026-01-01&to=2026-08-20");
  });

  it("writes the keys in a fixed order, so the URL does not churn", () => {
    expect(
      filtersToSearch(
        filters({
          query: "vpn",
          priority: "high",
          range: range(d(2026, 0, 1), d(2026, 7, 20)),
        }),
      ),
    ).toBe("?q=vpn&priority=high&from=2026-01-01&to=2026-08-20");
  });

  it("survives a round trip through readFilters", () => {
    const original = filters({
      query: "ระบบ",
      priority: "critical",
      range: range(d(2025, 10, 3), d(2026, 1, 28)),
    });
    expect(read(filtersToSearch(original).slice(1))).toEqual(original);
  });

  it("drops the time of day from a range end", () => {
    // The picker hands back midnights, but a range built from `new Date()` would
    // not, and the link must still be one day per end.
    const withTime = filters({
      range: {
        start: new Date(2026, 0, 1, 9, 30),
        end: new Date(2026, 7, 20, 23, 59),
      },
    });
    expect(filtersToSearch(withTime)).toBe("?from=2026-01-01&to=2026-08-20");
  });
});
