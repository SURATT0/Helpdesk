/**
 * Every colour value the app draws with from JavaScript, in one file.
 *
 * The rule this file exists to make true: **a colour that JS needs lives here;
 * a colour only a class name needs lives in `tailwind.config.ts`.** Nothing is
 * in both. The config imports this module and builds its `status` and
 * `priority` token groups from it, so the class `bg-status-pending-bg` and the
 * value `BADGE.violet.bg` cannot come apart — they are the same string.
 *
 * Why any colour is a JS value at all: a badge takes its colour from `style`,
 * because the pair is chosen at runtime from a status or an entity name, and a
 * class string built from a variable defeats Tailwind's content scanner.
 *
 * `sla`, the neutrals and the intent washes are deliberately NOT here: nothing
 * in JS reads them, they are only ever class names, so the config is their one
 * home and adding them would put half of them in two places again.
 *
 * These are semantic and were deliberately not rebranded with the brown/cream/
 * green theme — see frontend/CLAUDE.md.
 */
export type ColourPair = { fg: string; bg: string };

/**
 * The foreground/background pairs a badge is drawn in.
 *
 * Six maps used to spell these out independently — ticket status, user role,
 * audit entity family, problem status — and they were spelling out the SAME
 * pairs. `#475569` on `#f1f5f9` appeared in five of them under five different
 * names, so "make the neutral badge a shade darker" was a five-file change with
 * no way to know you had found them all.
 */
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
} as const satisfies Record<string, ColourPair>;

export type BadgeTone = keyof typeof BADGE;

/**
 * The dot beside a priority word. A single colour, not a pair — the label sits
 * on the row's own background, so only the dot is filled.
 *
 * Read twice: `PRIORITY_META` in lib/domain builds the label+dot pairs from it,
 * and the config's `priority` tokens come from it for the four places that
 * name a priority colour statically (the closed-log's dots).
 */
export const PRIORITY_DOT = {
  critical: "#dc2626",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#94a3b8",
} as const;

/**
 * Avatar tones, picked deterministically from a name (`toneForName`).
 *
 * Deliberately its own set, and not all four line up with `BADGE` — `blue` is
 * the same pair, `green` and `red` are softer, `pink` has no badge twin at all.
 * That reads as an accident when the two sets sit in different files, so they
 * sit here together: an avatar is a person, not a state, and it is allowed a
 * gentler wash than a badge that has to carry a word.
 */
export const AVATAR_TONE = {
  blue: { fg: "#1d4ed8", bg: "#dbeafe" },
  green: { fg: "#047857", bg: "#d1fae5" },
  pink: { fg: "#be185d", bg: "#fce7f3" },
  red: { fg: "#b91c1c", bg: "#fee2e2" },
} as const satisfies Record<string, ColourPair>;

export type AvatarTone = keyof typeof AVATAR_TONE;
