import { apiRequest } from "@/lib/api-client";
import {
  kbArticleEnvelope,
  kbListSchema,
  kbSuggestSchema,
  type KbArticle,
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
