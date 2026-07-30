/**
 * Problem vocabulary. Mirrors the Prisma `ProblemStatus` enum EXACTLY, same
 * pattern as shared/domain.ts for the ticket enums.
 */
export const PROBLEM_STATUSES = [
  "investigating",
  "known_error",
  "resolved",
  "closed",
] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
