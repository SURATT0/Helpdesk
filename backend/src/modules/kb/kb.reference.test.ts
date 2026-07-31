import { describe, expect, it } from "vitest";
import { kbService } from "./kb.service";
import { KB_ARTICLES } from "./kb.data";

/**
 * These two helpers are the whole integrity story for `problems.kb_article_id`:
 * the KB is a static dataset with no table, so `exists` on write is what stops a
 * dangling reference being stored, and `reference` on read is what stops a stale
 * one breaking the page.
 */
describe("kbService.exists", () => {
  it("accepts every id in the dataset", () => {
    expect(KB_ARTICLES.length).toBeGreaterThan(0);
    for (const article of KB_ARTICLES) {
      expect(kbService.exists(article.id)).toBe(true);
    }
  });

  it("rejects an unknown id", () => {
    expect(kbService.exists("KB-does-not-exist")).toBe(false);
  });

  it("rejects the empty string rather than matching loosely", () => {
    expect(kbService.exists("")).toBe(false);
  });

  it("is exact, not a prefix or case-insensitive match", () => {
    const id = KB_ARTICLES[0].id;
    expect(kbService.exists(id.slice(0, -1))).toBe(false);
    expect(kbService.exists(id.toLowerCase())).toBe(
      id === id.toLowerCase(), // only true if the id was already lowercase
    );
  });
});

describe("kbService.reference", () => {
  it("resolves a known id to id + title + category", () => {
    const article = KB_ARTICLES[0];
    expect(kbService.reference(article.id)).toEqual({
      id: article.id,
      title: article.title,
      category: article.category,
    });
  });

  // Non-throwing on purpose: a problem holding a retired id must still load.
  it("returns null for an unknown id instead of throwing", () => {
    expect(kbService.reference("KB-retired")).toBeNull();
  });

  it("returns null for null", () => {
    expect(kbService.reference(null)).toBeNull();
  });

  it("does not leak the article body", () => {
    const ref = kbService.reference(KB_ARTICLES[0].id);
    expect(ref).not.toHaveProperty("body");
  });
});
