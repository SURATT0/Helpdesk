import { z } from "zod";

/**
 * One row of the service catalog, as the ticket list filter reads it.
 * Retired (`active: false`) rows are included on purpose — a filter still
 * needs to point at a code no longer offered, to find the old tickets that
 * used it. The intake form does not use this schema at all: it builds its
 * dropdown straight from `config/services.json` (see
 * docs/adding-a-service.md), never from this API.
 */
export const serviceCatalogEntrySchema = z.object({
  code: z.string(),
  label: z.string(),
  group: z.string(),
  order: z.number(),
  active: z.boolean(),
});

export type ServiceCatalogEntry = z.infer<typeof serviceCatalogEntrySchema>;

export const serviceCatalogListSchema = z.object({
  data: z.array(serviceCatalogEntrySchema),
});
