/**
 * Asset vocabulary. Mirrors the Prisma enums EXACTLY (same pattern as
 * shared/domain.ts for the ticket enums) so the API layer never imports
 * generated types directly.
 */
export const ASSET_KINDS = [
  "laptop",
  "desktop",
  "phone",
  "tablet",
  "printer",
  "server",
  "network",
  "software",
  "other",
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = ["active", "in_repair", "retired"] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];
