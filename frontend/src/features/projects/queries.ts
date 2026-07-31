import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  fetchProject,
  fetchProjects,
  updateProject,
} from "./api";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas";

export const projectKeys = {
  all: ["projects"] as const,
  list: () => ["projects", "list"] as const,
  detail: (id: number) => ["projects", "detail", id] as const,
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
