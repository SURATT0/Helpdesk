import { z } from "zod";
import { PROBLEM_STATUSES } from "./problem.types";

export const problemStatusSchema = z.enum(PROBLEM_STATUSES);

export const listProblemsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: problemStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

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
