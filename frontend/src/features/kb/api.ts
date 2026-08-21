import { apiRequest } from "@/lib/api-client";
import {
  kbArticleEnvelope,
  kbListSchema,
  kbSuggestSchema,
  type KbArticle,
  type KbArticleInput,
  type KbSuggestion,
  type KbSummary,
} from "./schemas";

export async function fetchArticles(
  q: string,
  category: string | null,
): Promise<{ articles: KbSummary[]; categories: string[] }> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (category) params.set("category", category);
  const qs = params.toString();
  const body = await apiRequest(`/kb${qs ? `?${qs}` : ""}`);
  const parsed = kbListSchema.parse(body);
  return { articles: parsed.data, categories: parsed.meta.categories };
}

export async function fetchArticle(id: string): Promise<KbArticle> {
  const body = await apiRequest(`/kb/${encodeURIComponent(id)}`);
  return kbArticleEnvelope.parse(body).data;
}

export async function fetchSuggestions(q: string): Promise<KbSuggestion[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  const body = await apiRequest(`/kb/suggest${qs ? `?${qs}` : ""}`);
  return kbSuggestSchema.parse(body).data;
}

/** Author a new article. The server assigns the id and returns it. */
export async function createArticle(
  input: KbArticleInput,
): Promise<KbArticle> {
  const body = await apiRequest("/kb", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return kbArticleEnvelope.parse(body).data;
}

/**
 * Edit an article. Partial on purpose — publishing is `{ status: "published" }`
 * and nothing else, so the button does not have to resend the whole document.
 */
export async function updateArticle(
  id: string,
  input: Partial<KbArticleInput>,
): Promise<KbArticle> {
  const body = await apiRequest(`/kb/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return kbArticleEnvelope.parse(body).data;
}

/** Retire an article. 204, so there is no body to parse. */
export async function deleteArticle(id: string): Promise<void> {
  await apiRequest(`/kb/${encodeURIComponent(id)}`, { method: "DELETE" });
}
