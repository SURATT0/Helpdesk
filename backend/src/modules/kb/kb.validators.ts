import { z } from "zod";

export const listQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
});

export const suggestQuery = z.object({ q: z.string().optional() });

export const idParam = z.object({ id: z.string().min(1) });

/**
 * Tags are matched whole and lower-cased on the way in, so an author typing
 * "VPN" and a searcher typing "vpn" meet. Blanks are dropped and duplicates
 * collapsed rather than rejected — a trailing comma in the tag field is a typo,
 * not something to make someone fix.
 */
const tags = z
  .array(z.string())
  .max(12, "At most 12 tags")
  .transform((raw) => [
    ...new Set(raw.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ]);

const articleFields = {
  title: z.string().trim().min(3).max(200),
  excerpt: z.string().trim().min(10).max(500),
  body: z.string().trim().min(20),
  categoryId: z.number().int().positive(),
  tags,
  // Reading time is the author's own estimate. Capped at an hour because past
  // that it is a manual, not an article.
  readMin: z.number().int().min(1).max(60),
  status: z.enum(["draft", "published"]),
};

/**
 * A new article. `status` defaults to `draft`: publishing is a decision, and
 * defaulting the other way would put a half-written page in front of everyone
 * the moment someone hit save.
 */
export const createArticleBody = z.object({
  ...articleFields,
  status: articleFields.status.default("draft"),
});

/**
 * An edit. Every field optional — the editor sends what changed, and publishing
 * is just `{ status: "published" }`. At least one field required, so an empty
 * body is a bad request rather than a write that quietly does nothing.
 */
export const updateArticleBody = z
  .object(articleFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to update",
  });

export type CreateArticleInput = z.infer<typeof createArticleBody>;
export type UpdateArticleInput = z.infer<typeof updateArticleBody>;
