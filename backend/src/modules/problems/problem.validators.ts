import { z } from "zod";
import { PROBLEM_STATUSES } from "./problem.types";

export const problemStatusSchema = z.enum(PROBLEM_STATUSES);

export const listProblemsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: problemStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * PATCH /problems/:id — edit the investigation itself.
 *
 * Every field is optional, and `null` is meaningful for the nullable ones: it
 * clears the field. `.strict()` so a typo'd key is a 400 rather than a silently
 * ignored edit the user believes was saved.
 */
export const updateProblemSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    rootCause: z.string().trim().max(5000).nullable().optional(),
    workaround: z.string().trim().max(5000).nullable().optional(),
    status: problemStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateProblemInput = z.infer<typeof updateProblemSchema>;

/** POST /tickets/:id/problem — either link an existing problem or create one. */
export const linkOrConvertSchema = z
  .object({
    problemId: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullish(),
  })
  .refine((v) => (v.problemId == null) !== (v.title == null), {
    message: "Provide exactly one of problemId (link) or title (convert)",
  });

export type LinkOrConvertInput = z.infer<typeof linkOrConvertSchema>;
