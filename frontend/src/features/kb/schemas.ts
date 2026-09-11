import { z } from "zod";

/** Unpublished writing. Only people who may edit articles are sent drafts. */
export const KB_STATUSES = ["draft", "published"] as const;

export const kbSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  categoryCode: z.string(),
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
  meta: z.object({
    categories: z.array(z.object({ code: z.string(), label: z.string() })),
  }),
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
  /**
   * The SUBJECT, as a cross-tenant category code — not a category id.
   *
   * An article belongs to no customer (one page on resetting a password serves
   * every tenant), and every category row now belongs to one. Sending an id
   * would attach the shared library to whichever tenant owned the row. The
   * editor picks from its own categories and sends that row's `code`.
   */
  categoryCode: string;
  tags: string[];
  readMin: number;
  status: KbStatus;
};
