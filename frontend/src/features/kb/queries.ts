import { useQuery } from "@tanstack/react-query";
import { fetchArticle, fetchArticles, fetchSuggestions } from "./api";

export const kbKeys = {
  list: (q: string, category: string | null) =>
    ["kb", "list", q, category] as const,
  article: (id: string) => ["kb", "article", id] as const,
  suggest: (q: string) => ["kb", "suggest", q] as const,
};

export function useKbArticles(q: string, category: string | null) {
  return useQuery({
    queryKey: kbKeys.list(q, category),
    queryFn: () => fetchArticles(q, category),
  });
}

export function useKbArticle(id: string) {
  return useQuery({
    queryKey: kbKeys.article(id),
    queryFn: () => fetchArticle(id),
    enabled: id.length > 0,
  });
}

export function useKbSuggest(q: string, enabled: boolean) {
  return useQuery({
    queryKey: kbKeys.suggest(q),
    queryFn: () => fetchSuggestions(q),
    enabled,
  });
}
