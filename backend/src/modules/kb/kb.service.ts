import { NotFound } from "../../shared/errors";
import { KB_ARTICLES, type KbArticle } from "./kb.data";

export type KbSummary = Omit<KbArticle, "body">;

const toSummary = ({ body: _body, ...rest }: KbArticle): KbSummary => rest;

export const kbService = {
  list(opts: { q?: string; category?: string }): KbSummary[] {
    const q = (opts.q ?? "").trim().toLowerCase();
    const category = opts.category;
    return KB_ARTICLES.filter((a) => {
      if (category && a.category !== category) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.tags.some((t) => t.includes(q))
      );
    }).map(toSummary);
  },

  categories(): string[] {
    return [...new Set(KB_ARTICLES.map((a) => a.category))];
  },

  get(id: string): KbArticle {
    const found = KB_ARTICLES.find((a) => a.id === id);
    if (!found) throw NotFound("Article not found");
    return found;
  },

  /** Deflection suggestions for the create-ticket form (top 3 by relevance). */
  suggest(q: string) {
    const query = q.trim().toLowerCase();
    const matches = query
      ? KB_ARTICLES.filter(
          (a) =>
            a.tags.some((t) => query.includes(t) || t.includes(query)) ||
            a.title.toLowerCase().includes(query),
        )
      : KB_ARTICLES;
    return matches
      .slice(0, 3)
      .map((a) => ({ id: a.id, title: a.title, readMin: a.readMin, tags: a.tags }));
  },
};
