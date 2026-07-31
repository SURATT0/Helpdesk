import { apiRequest } from "@/lib/api-client";
import {
  projectEnvelopeSchema,
  projectListSchema,
  type CreateProjectInput,
  type Project,
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
