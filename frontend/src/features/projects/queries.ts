import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  deleteProject,
  fetchDeletionImpact,
  fetchProject,
  fetchProjects,
  updateProject,
} from "./api";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas";

export const projectKeys = {
  all: ["projects"] as const,
  list: () => ["projects", "list"] as const,
  detail: (id: number) => ["projects", "detail", id] as const,
  deletionImpact: (id: number) => ["projects", "deletion-impact", id] as const,
};

/**
 * `enabled` lets a caller skip the fetch when the list would go unused — the
 * Users screen only needs projects for the editable picker, and a read-only
 * viewer would otherwise pay for a request it never reads.
 */
export function useProjects({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: fetchProjects,
    enabled,
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => fetchProject(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => createProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

/**
 * Set or clear a project's owner / backup owner. Also invalidates tickets: the
 * owner decides who new tickets route to, so any assignee-scoped list on screen
 * is now potentially stale.
 */
export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateProjectInput }) =>
      updateProject(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}

/**
 * How many people a deletion would strand, read when the dialog opens.
 *
 * Fetched fresh rather than taken from the list already on screen: the list's
 * `members` count can be minutes old, and this number is the one the confirm
 * button is enabled on. `staleTime: 0` for the same reason.
 */
export function useDeletionImpact(id: number | null) {
  return useQuery({
    queryKey: projectKeys.deletionImpact(id ?? -1),
    queryFn: () => fetchDeletionImpact(id as number),
    enabled: id != null,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Soft-delete a project.
 *
 * Invalidates tickets alongside projects: a project decides where a member's
 * next ticket lands, so removing one changes future routing, and any
 * assignee-scoped list on screen may now be stale — the same reasoning
 * `useUpdateProject` uses for the owner change.
 */
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.all });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
