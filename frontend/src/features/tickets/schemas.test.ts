import { describe, expect, it } from "vitest";
import { PRIORITIES } from "@/lib/domain";
import {
  DB_STATUSES,
  DISPLAY_STATUSES,
  HISTORY_STATUSES,
} from "@/lib/ticket-status";
import {
  displayStatusSchema,
  prioritySchema,
  ticketStatusRecordSchema,
  ticketStatusSchema,
} from "./schemas";

/**
 * This file is the parse boundary: what it refuses, the app cannot show. A list
 * here that has fallen behind `lib/ticket-status` does not read as a stale
 * constant — a legitimate row fails to parse and the list goes to its error
 * state. So the enums are built from the vocabularies, and this checks the
 * agreement in both directions rather than trusting that they still are.
 */
const pairs = [
  ["ticketStatusSchema", ticketStatusSchema, DB_STATUSES],
  ["ticketStatusRecordSchema", ticketStatusRecordSchema, HISTORY_STATUSES],
  ["displayStatusSchema", displayStatusSchema, DISPLAY_STATUSES],
  ["prioritySchema", prioritySchema, PRIORITIES],
] as const;

describe("the ticket enums match the vocabulary they came from", () => {
  for (const [name, schema, words] of pairs) {
    it(`${name} accepts exactly its list`, () => {
      expect([...schema.options].sort()).toEqual([...words].sort());
      for (const w of words) expect(schema.safeParse(w).success, w).toBe(true);
    });
  }

  it("refuses a word from a neighbouring vocabulary", () => {
    // `open` and `resolved` are history-only; no ticket may be stored as one.
    expect(ticketStatusSchema.safeParse("open").success).toBe(false);
    expect(ticketStatusSchema.safeParse("resolved").success).toBe(false);
    // "In Progress" is derived, so it is never a value a write may send.
    expect(ticketStatusSchema.safeParse("in_progress").success).toBe(false);
    expect(displayStatusSchema.safeParse("resolved").success).toBe(false);
  });
});
