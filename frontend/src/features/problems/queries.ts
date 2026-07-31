import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProblems,
  linkOrConvertProblem,
  unlinkProblem,
  type ProblemFilter,
} from "./api";
import type { LinkOrConvertInput } from "./schemas";

export const problemKeys = {
  all: ["problems"] as const,
  list: (f: ProblemFilter) => ["problems", "list", f] as const,
};

export function useProblems(
  filter: ProblemFilter = {},
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: problemKeys.list(filter),
    queryFn: () => fetchProblems(filter),
    enabled: opts.enabled ?? true,
  });
}

/**
 * Link or convert, then refresh both sides: the problem list gains a ticket (so
 * its `ticketCount` changed) and the ticket now carries a `problem`. Invalidating
 * tickets broadly rather than one id, because the list view shows the link too.
 */
export function useLinkOrConvertProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      input,
    }: {
      ticketId: number;
      input: LinkOrConvertInput;
    }) => linkOrConvertProblem(ticketId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: problemKeys.all });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

export function useUnlinkProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: number) => unlinkProblem(ticketId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: problemKeys.all });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
