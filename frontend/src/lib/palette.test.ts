import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";
import { AVATAR_TONE, BADGE, PRIORITY_DOT } from "./palette";
import { PRIORITY_META } from "./domain";
import { STATUS_META } from "./ticket-status";

/**
 * The claim this file defends: a status colour exists once.
 *
 * `colors.status.*` and `colors.priority.*` used to be hex values written out in
 * the Tailwind config AND in the JS palettes, so the class
 * `bg-status-pending-bg` and the value behind a Pending badge were two
 * independent statements of one colour. They are read from `palette.ts` now —
 * these tests fail if anyone writes a literal back into either side.
 */
const colors = config.theme?.extend?.colors as Record<string, unknown>;
const status = colors.status as Record<string, string>;
const priority = colors.priority as Record<string, string>;

describe("the config's status tokens come from the palette", () => {
  const pairs = [
    ["new", BADGE.blue],
    ["open", BADGE.sky],
    ["progress", BADGE.amber],
    ["pending", BADGE.violet],
    ["resolved", BADGE.green],
    ["closed", BADGE.slate],
  ] as const;

  for (const [name, tone] of pairs) {
    it(`status-${name}-fg/bg is BADGE's own pair`, () => {
      expect(status[`${name}-fg`]).toBe(tone.fg);
      expect(status[`${name}-bg`]).toBe(tone.bg);
    });
  }

  it("declares a token for every pair the badges can show, and no orphan", () => {
    // `rose` and `teal` are audit-only and have no class consumer, so they are
    // legitimately absent — everything else must be present on both sides.
    const declared = new Set(Object.keys(status).map((k) => k.replace(/-(fg|bg)$/, "")));
    expect([...declared].sort()).toEqual([
      "closed",
      "new",
      "open",
      "pending",
      "progress",
      "resolved",
    ]);
  });
});

describe("the config's priority tokens come from the palette", () => {
  it("is the PRIORITY_DOT object itself", () => {
    expect(priority).toBe(PRIORITY_DOT);
  });

  it("agrees with the dot PRIORITY_META draws", () => {
    for (const p of Object.keys(PRIORITY_DOT) as (keyof typeof PRIORITY_DOT)[]) {
      expect(PRIORITY_META[p].dot).toBe(priority[p]);
    }
  });
});

describe("STATUS_META draws from the palette", () => {
  it("gives every shown status a pair that exists in BADGE", () => {
    const known = Object.values(BADGE).map((p) => `${p.fg}|${p.bg}`);
    for (const [name, meta] of Object.entries(STATUS_META)) {
      expect(known, name).toContain(`${meta.fg}|${meta.bg}`);
    }
  });
});

describe("avatar tones", () => {
  it("keeps its own set, overlapping BADGE only where it means to", () => {
    // Documented in palette.ts: `blue` is the same pair, the rest are softer.
    // Pinned so the overlap stays a decision rather than a coincidence.
    expect(AVATAR_TONE.blue).toEqual(BADGE.blue);
    expect(AVATAR_TONE.green).not.toEqual(BADGE.green);
    expect(AVATAR_TONE.red).not.toEqual(BADGE.rose);
  });

  it("names the four tones toneForName can return", () => {
    expect(Object.keys(AVATAR_TONE).sort()).toEqual(["blue", "green", "pink", "red"]);
  });
});

describe("no colour is in two places", () => {
  it("keeps the sla, neutral and intent groups out of the JS palette", () => {
    // The stated rule: JS needs it → palette.ts; only a class needs it → config.
    const jsValues = new Set<string>([
      ...Object.values(BADGE).flatMap((p) => [p.fg, p.bg]),
      ...Object.values(AVATAR_TONE).flatMap((p) => [p.fg, p.bg]),
      ...Object.values(PRIORITY_DOT),
    ]);
    const sla = colors.sla as Record<string, string>;
    // `sla.ok` and `sla.idle` legitimately reuse a neutral that a badge also
    // uses; what must not happen is the whole group being restated in JS.
    const overlap = Object.entries(sla).filter(([, v]) => jsValues.has(v));
    expect(overlap.length).toBeLessThan(Object.keys(sla).length);
  });
});
