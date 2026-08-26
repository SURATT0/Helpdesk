import { z } from "zod";

/** Unpublished writing. Only people who may edit articles are sent drafts. */
export const KB_STATUSES = ["draft", "published"] as const;

export const kbSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  categoryId: z.number(),
  tags: z.array(z.string()),
  readMin: z.number(),
  updatedAt: z.string(),
  excerpt: z.string(),
  status: z.enum(KB_STATUSES),
  author: z.object({ id: z.number(), name: z.string() }).nullable(),
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

export type KbStatus = (typeof KB_STATUSES)[number];
export type KbSummary = z.infer<typeof kbSummarySchema>;
export type KbArticle = z.infer<typeof kbArticleSchema>;
export type KbSuggestion = z.infer<typeof kbSuggestSchema>["data"][number];

/**
 * What the editor sends. The id is not here — the server assigns the next code
 * in the `KB-nnn` series, so an author never picks one.
 */
export type KbArticleInput = {
  title: string;
  excerpt: string;
  body: string;
  categoryId: number;
  tags: string[];
  readMin: number;
  status: KbStatus;
};
