import { z } from "zod";

/**
 * One phrase somebody typed under "Other", with how often it has come up.
 *
 * Grouped by the API case- and space-insensitively, so "Printer jams" and
 * "printer  jams" arrive as one row. `text` is the most recent spelling rather
 * than a normalised one: the reader is deciding what to NAME a category, and a
 * lower-cased, squashed version of what someone wrote is a worse starting point
 * than their own words.
 */
export const otherDescriptionSchema = z.object({
  text: z.string(),
  count: z.number(),
  customerId: z.number(),
  customerName: z.string(),
  /** So a reader can open one and see the whole ticket behind the phrase. */
  ticketIds: z.array(z.number()),
  lastUsedAt: z.string(),
});

export const otherDescriptionListSchema = z.object({
  data: z.array(otherDescriptionSchema),
});

export const createdCategorySchema = z.object({
  data: z.object({
    id: z.number(),
    name: z.string(),
    code: z.string(),
    customerId: z.number(),
  }),
});

export type OtherDescription = z.infer<typeof otherDescriptionSchema>;
