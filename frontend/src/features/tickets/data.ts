const TONES = ["blue", "green", "pink", "red"] as const;
export type AvatarTone = (typeof TONES)[number];

/** Deterministic avatar colour for an assignee name. */
export function toneForName(name: string): AvatarTone {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}
