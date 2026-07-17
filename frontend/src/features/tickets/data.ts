import type { SlaState } from "./schemas";

/** SLA-due text colour by state (presentational). */
export const slaColor: Record<SlaState, string> = {
  danger: "#dc2626",
  warn: "#b45309",
  ok: "#475569",
  paused: "#94a3b8",
  met: "#16a34a",
};

const TONES = ["blue", "green", "pink", "red"] as const;
export type AvatarTone = (typeof TONES)[number];

/** Deterministic avatar colour for an assignee name. */
export function toneForName(name: string): AvatarTone {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}
