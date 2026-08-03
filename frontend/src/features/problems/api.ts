import { apiRequest } from "@/lib/api-client";
import {
  problemEnvelopeSchema,
  problemListSchema,
  type LinkOrConvertInput,
  type Problem,
  type ProblemStatus,
} from "./schemas";

export type ProblemFilter = {
  search?: string;
  status?: ProblemStatus;
  limit?: number;
};

export async function fetchProblems(
  filter: ProblemFilter = {},
): Promise<Problem[]> {
  const qs = new URLSearchParams();
  if (filter.search) qs.set("search", filter.search);
  if (filter.status) qs.set("status", filter.status);
  if (filter.limit != null) qs.set("limit", String(filter.limit));
  const suffix = qs.toString();
  const body = await apiRequest(`/problems${suffix ? `?${suffix}` : ""}`);
  return problemListSchema.parse(body).data;
}

/** One problem by id, scoped server-side (404 when out of scope). */
export async function fetchProblem(id: number): Promise<Problem> {
  const body = await apiRequest(`/problems/${id}`);
  return problemEnvelopeSchema.parse(body).data;
}

/**
 * Edit the investigation. Every field is optional; `null` clears a nullable one.
 * The server refuses `status: "known_error"` unless a workaround exists — that's
 * a 400 with a message worth surfacing verbatim.
 */
export type UpdateProblemInput = {
  title?: string;
  description?: string | null;
  rootCause?: string | null;
  workaround?: string | null;
  status?: ProblemStatus;
  /** KB article id, e.g. "KB-042". `null` unlinks. Validated server-side. */
  kbArticleId?: string | null;
};

export async function updateProblem(
  id: number,
  input: UpdateProblemInput,
): Promise<Problem> {
  const body = await apiRequest(`/problems/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return problemEnvelopeSchema.parse(body).data;
}

/**
 * Link this ticket to an existing problem, or convert it into a new one. One
 * endpoint, and the server rejects passing both — see `LinkOrConvertInput`.
 * Returns the problem the ticket now belongs to.
 */
export async function linkOrConvertProblem(
  ticketId: number,
  input: LinkOrConvertInput,
): Promise<Problem> {
  const body = await apiRequest(`/tickets/${ticketId}/problem`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return problemEnvelopeSchema.parse(body).data;
}

/** Detach the ticket from its problem. The problem itself is left alone. */
export async function unlinkProblem(ticketId: number): Promise<void> {
  await apiRequest(`/tickets/${ticketId}/problem`, { method: "DELETE" });
}
