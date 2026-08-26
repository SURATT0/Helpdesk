import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import {
  createArticle,
  deleteArticle,
  fetchArticle,
  fetchArticles,
  fetchSuggestions,
  updateArticle,
} from "./api";
import type { KbArticleInput } from "./schemas";

export const kbKeys = {
  /** Everything KB — the coarse key a write invalidates. */
  all: ["kb"] as const,
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
    /**
     * A 404 is an answer, not a failure to be retried.
     *
     * Without this the query never reaches `error` at all: the global default
     * retries once, the retry gets PAUSED, and the query sits at
     * `status: "pending"` / `fetchStatus: "paused"` indefinitely — `isError`
     * stays false and `error` stays undefined, so the page falls through to the
     * generic "could not load" with a Retry button instead of saying the article
     * does not exist. Refusing the retry settles it into `error` immediately and
     * the 404 branch works as written.
     *
     * Drafts are what make this worth fixing: a reader following a link to an
     * unpublished article gets a 404 by design, so it is a routine answer now
     * rather than only a mistyped URL.
     */
    retry: (failures, error) =>
      error instanceof ApiError && error.status === 404 ? false : failures < 1,
  });
}

export function useKbSuggest(q: string, enabled: boolean) {
  return useQuery({
    queryKey: kbKeys.suggest(q),
    queryFn: () => fetchSuggestions(q),
    enabled,
  });
}

/**
 * Writes invalidate the whole `kb` key rather than a computed list key.
 *
 * A list key carries the search text and the category filter, so an edit can
 * change which lists an article belongs to — retagging it, or moving it between
 * categories. Narrowing the invalidation would leave it on screen under a filter
 * it no longer matches, and the KB is small enough that refetching is cheap.
 */
export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KbArticleInput) => createArticle(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbKeys.all }),
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<KbArticleInput>;
    }) => updateArticle(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbKeys.all }),
  });
}

export function useDeleteArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteArticle(id),
    // A problem can cite an article, and the citation goes stale the moment it
    // is deleted — so the problems it might be showing on are refetched too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: kbKeys.all });
      qc.invalidateQueries({ queryKey: ["problems"] });
    },
  });
}
