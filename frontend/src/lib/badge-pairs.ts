/**
 * The foreground/background pairs a badge is drawn in.
 *
 * Six maps used to spell these out independently — ticket status, user role,
 * audit entity family, problem status, and the avatar tones — and they were
 * spelling out the SAME pairs. `#475569` on `#f1f5f9` appeared in five of them
 * under five different names, so "make the neutral badge a shade darker" was a
 * five-file change with no way to know you had found them all.
 *
 * Kept as values rather than Tailwind classes because a badge takes its colour
 * from `style`: the pairs are chosen at runtime from a status or an entity name,
 * and a class string cannot be built from a variable without defeating the
 * content scanner. The Tailwind `status.*` tokens carry the same values for the
 * places that CAN name their colour statically.
 *
 * These are semantic and were deliberately NOT rebranded with the brown/cream/
 * green theme — see frontend/CLAUDE.md.
 */
export type BadgePair = { fg: string; bg: string };

export const BADGE = {
  /** Waiting to be picked up. */
  blue: { fg: "#1d4ed8", bg: "#dbeafe" },
  /** Being looked at — an investigation, a ticket someone has taken. */
  sky: { fg: "#0369a1", bg: "#e0f2fe" },
  /** In hand, and the clock is running. */
  amber: { fg: "#b45309", bg: "#fef3c7" },
  /** Waiting on someone else. */
  violet: { fg: "#6d28d9", bg: "#ede9fe" },
  /** Done, and it worked. */
  green: { fg: "#15803d", bg: "#dcfce7" },
  /** Over — the neutral one, and the most reused of all. */
  slate: { fg: "#475569", bg: "#f1f5f9" },
  /** A fault: a problem record, a failure. */
  rose: { fg: "#be123c", bg: "#ffe4e6" },
  /** A thing rather than an event — an asset. */
  teal: { fg: "#0f766e", bg: "#ccfbf1" },
} as const satisfies Record<string, BadgePair>;

export type BadgeTone = keyof typeof BADGE;
