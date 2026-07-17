import { z } from "zod";

export const kbSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  readMin: z.number(),
  updatedAt: z.string(),
  excerpt: z.string(),
});

export const kbArticleSchema = kbSummarySchema.extend({ body: z.string() });

export const kbListSchema = z.object({
  data: z.array(kbSummarySchema),
  meta: z.object({ categories: z.array(z.string()) }),
});

export const kbArticleEnvelope = z.object({ data: kbArticleSchema });

export const kbSuggestSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      readMin: z.number(),
      tags: z.array(z.string()),
    }),
  ),
});

export type KbSummary = z.infer<typeof kbSummarySchema>;
export type KbArticle = z.infer<typeof kbArticleSchema>;
export type KbSuggestion = z.infer<typeof kbSuggestSchema>["data"][number];
