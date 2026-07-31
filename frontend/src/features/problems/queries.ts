import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProblem,
  fetchProblems,
  linkOrConvertProblem,
  unlinkProblem,
  updateProblem,
  type ProblemFilter,
  type UpdateProblemInput,
} from "./api";
import type { LinkOrConvertInput } from "./schemas";

export const problemKeys = {
  all: ["problems"] as const,
  list: (f: ProblemFilter) => ["problems", "list", f] as const,
  detail: (id: number) => ["problems", "detail", id] as const,
};

/**
 * One problem, for the panel on a linked ticket. A direct fetch rather than
 * scanning the list: the ticket payload carries only id/title/status, and root
 * cause + workaround are what the panel actually needs to show.
 */
export function useProblem(
  id: number | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: problemKeys.detail(id ?? 0),
    queryFn: () => fetchProblem(id as number),
    enabled: (opts.enabled ?? true) && id != null,
  });
}

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

/**
 * Edit a problem. Invalidates tickets too: the ticket payload embeds the
 * problem's title and status, so a rename or status change makes every ticket
 * row showing that problem stale.
 */
export function useUpdateProblem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateProblemInput }) =>
      updateProblem(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: problemKeys.detail(id) });
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
