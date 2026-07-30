import type { AuthUser } from "../../shared/auth";
import { BadRequest, Forbidden, NotFound } from "../../shared/errors";
import { mayReceiveAssignment } from "../tickets/ticket.scope";
import {
  projectRepository,
  type ProjectDto,
} from "./project.repository";
import { resolveProjectCustomerId } from "./project.scope";

export type CreateProjectInput = {
  name: string;
  customerId?: number;
  ownerId?: number | null;
  backupOwnerId?: number | null;
};

export type UpdateProjectInput = {
  name?: string;
  ownerId?: number | null;
  backupOwnerId?: number | null;
};

/**
 * Validate every owner slot being set in this request.
 *
 * Being a project's owner means being handed that project's tickets, so the rule
 * is the same one bulk reassignment uses — `mayReceiveAssignment`. Reusing it
 * rather than writing a second check is the point: a requester must never end up
 * holding tickets, and a manager must not be able to route work to another
 * tenant's staff.
 */
async function assertOwnersAssignable(
  actor: AuthUser,
  slots: Array<number | null | undefined>,
): Promise<void> {
  for (const userId of slots) {
    if (userId == null) continue; // omitted, or an explicit clear
    const candidate = await projectRepository.findOwnerCandidate(userId);
    if (!candidate) throw BadRequest(`Unknown user #${userId}`);
    if (!mayReceiveAssignment(actor, candidate)) {
      // Deliberately the same message whatever the reason — distinguishing "is a
      // requester" from "belongs to another customer" would leak the directory of
      // tenants the actor cannot see.
      throw Forbidden(`User #${userId} cannot own a project`);
    }
  }
}

export const projectService = {
  list(actor: AuthUser): Promise<ProjectDto[]> {
    return projectRepository.findMany(actor);
  },

  async get(id: number, actor: AuthUser): Promise<ProjectDto> {
    const project = await projectRepository.findById(id, actor);
    if (!project) throw NotFound(`Project #${id} not found`);
    return project;
  },

  async create(
    input: CreateProjectInput,
    actor: AuthUser,
  ): Promise<ProjectDto> {
    const customerId = resolveProjectCustomerId(actor, input.customerId);
    if (customerId == null) {
      throw BadRequest(
        "customerId is required: a platform admin must say which customer the project belongs to",
      );
    }
    await assertOwnersAssignable(actor, [input.ownerId, input.backupOwnerId]);
    return projectRepository.create(
      {
        name: input.name,
        customerId,
        ownerId: input.ownerId,
        backupOwnerId: input.backupOwnerId,
      },
      actor.id,
    );
  },

  async update(
    id: number,
    input: UpdateProjectInput,
    actor: AuthUser,
  ): Promise<ProjectDto> {
    // Row scope first, so an out-of-scope project 404s before we start
    // validating owners against it.
    await this.get(id, actor);
    await assertOwnersAssignable(actor, [input.ownerId, input.backupOwnerId]);
    const updated = await projectRepository.update(id, input, actor);
    if (!updated) throw NotFound(`Project #${id} not found`);
    return updated;
  },
};
