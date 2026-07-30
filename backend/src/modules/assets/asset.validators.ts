import { z } from "zod";
import { ASSET_KINDS, ASSET_STATUSES } from "./asset.types";

export const assetKindSchema = z.enum(ASSET_KINDS);
export const assetStatusSchema = z.enum(ASSET_STATUSES);

export const listAssetsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: assetStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const createAssetSchema = z.object({
  assetTag: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  kind: assetKindSchema.optional().default("other"),
  status: assetStatusSchema.optional().default("active"),
  serial: z.string().trim().max(120).nullish(),
  location: z.string().trim().max(200).nullish(),
  ownerId: z.number().int().positive().nullish(),
  // Platform admins have no customer of their own, so they must say which
  // tenant the asset belongs to. Ignored for scoped (non-admin) actors.
  customerId: z.number().int().positive().nullish(),
});

export const updateAssetSchema = createAssetSchema.partial();

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
