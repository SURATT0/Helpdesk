import { apiRequest } from "@/lib/api-client";
import {
  projectDeletionImpactSchema,
  projectEnvelopeSchema,
  projectListSchema,
  type CreateProjectInput,
  type Project,
  type ProjectDeletionImpact,
  type UpdateProjectInput,
} from "./schemas";

export async function fetchProjects(): Promise<{
  projects: Project[];
  total: number;
}> {
  const body = await apiRequest("/projects");
  const parsed = projectListSchema.parse(body);
  return { projects: parsed.data, total: parsed.meta.total };
}

export async function fetchProject(id: number): Promise<Project> {
  const body = await apiRequest(`/projects/${id}`);
  return projectEnvelopeSchema.parse(body).data;
}

/** Requires `project:write` — managers and admins. */
export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const body = await apiRequest("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return projectEnvelopeSchema.parse(body).data;
}

/** Requires `project:write`. Used to set or clear the owner / backup owner. */
export async function updateProject(
  id: number,
  input: UpdateProjectInput,
): Promise<Project> {
  const body = await apiRequest(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return projectEnvelopeSchema.parse(body).data;
}

/**
 * What deleting this project would disturb — read when the dialog opens, so the
 * count shown is the server's own and not one the list happened to be holding.
 *
 * Behind `project:delete` like the deletion itself: 403 for anyone else.
 */
export async function fetchDeletionImpact(
  id: number,
): Promise<ProjectDeletionImpact> {
  const body = await apiRequest(`/projects/${id}/deletion-impact`);
  return projectDeletionImpactSchema.parse(body).data;
}

/**
 * Soft-delete a project. Requires `project:delete`, which no role holds
 * explicitly — only a super admin's wildcard satisfies it.
 *
 * Refused with 409 PROJECT_HAS_MEMBERS while anyone still routes through it.
 * Returns 204 with no body, so there is nothing to parse.
 */
export async function deleteProject(id: number): Promise<void> {
  await apiRequest(`/projects/${id}`, { method: "DELETE" });
}
