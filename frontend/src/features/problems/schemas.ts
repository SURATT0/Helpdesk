import { z } from "zod";

/** Mirrors the backend ProblemStatus enum exactly. */
export const PROBLEM_STATUSES = [
  "investigating",
  "known_error",
  "resolved",
  "closed",
] as const;

export const problemStatusSchema = z.enum(PROBLEM_STATUSES);

export const problemSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  status: problemStatusSchema,
  rootCause: z.string().nullable(),
  /** The interim fix agents need while the root cause is still open. */
  workaround: z.string().nullable(),
  /** Stored KB article id, whether or not it still resolves. */
  kbArticleId: z.string().nullable(),
  /**
   * The same article resolved server-side. An id present with a null reference
   * means the article was removed — a stale link, which the UI says out loud
   * rather than hiding.
   */
  kbArticle: z
    .object({ id: z.string(), title: z.string(), category: z.string() })
    .nullable(),
  createdBy: z.object({ id: z.number(), name: z.string() }).nullable(),
  /** How many incidents are linked — the "how widespread is this" signal. */
  ticketCount: z.number(),
  createdAt: z.string(),
});

export const problemListSchema = z.object({
  data: z.array(problemSchema),
  meta: z.object({ total: z.number() }),
});

export const problemEnvelopeSchema = z.object({ data: problemSchema });

export type ProblemStatus = z.infer<typeof problemStatusSchema>;
export type Problem = z.infer<typeof problemSchema>;

/**
 * Exactly one of these, enforced server-side: `problemId` links this ticket to an
 * existing problem, `title` converts it into a new one.
 */
export type LinkOrConvertInput =
  | { problemId: number }
  | { title: string; description?: string | null };
