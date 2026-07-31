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
