import { hasPermission, type AuthUser } from "../../shared/auth";
import {
  BadRequest,
  Forbidden,
  NotFound,
  ProjectHasMembers,
} from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { mayReceiveAssignment } from "../tickets/ticket.scope";
import {
  projectRepository,
  type ProjectDeletionImpact,
  type ProjectDto,
} from "./project.repository";
import { resolveProjectCustomerId } from "./project.scope";

/**
 * The permission a project deletion needs.
 *
 * Held by no role explicitly, so only `super_admin`'s `*` satisfies it — the
 * same arrangement `ticket:delete` uses, and for the same reason: closing or
 * emptying is the normal end of something's life, and deletion is the escape
 * hatch for a row that should never have existed. Adding it to a grant list is
 * what would widen it, and nothing does.
 */
export const PROJECT_DELETE = "project:delete";

/**
 * Gate a deletion, recording the refusal.
 *
 * Checked here rather than with `requirePermission` on the route — not because
 * the middleware is wrong, but because a denied attempt has to be written to the
 * trail against the project it named, and a middleware that sees only the role
 * has nothing to name. Same reasoning as the closure endpoints in
 * ticket.routes.ts, which also decline the middleware for a check that needs the
 * request's subject.
 *
 * `hasPermission` is the existing central helper; this adds no new role test.
 */
function assertMayDelete(actor: AuthUser, projectId?: number): void {
  if (hasPermission(actor, PROJECT_DELETE)) return;
  if (projectId != null) {
    // Fire-and-forget: the refusal is the answer, and failing to write the trail
    // must not turn a clean 403 into a 500. Logged rather than awaited for the
    // same reason — the caller is being refused either way.
    void auditRepository
      .record({
        userId: actor.id,
        action: "project.delete_denied",
        entity: "project",
        entityId: projectId,
        meta: { actorRole: actor.role, permission: PROJECT_DELETE },
      })
      .catch(() => {});
  }
  throw Forbidden("You don't have permission to delete projects");
}

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

  /**
   * What deleting this project would disturb — read by the confirmation dialog
   * so the number a person is shown is the number the guard below refuses on.
   *
   * Behind the same permission as the delete itself: telling someone who may not
   * delete how many people a project holds is answering the question anyway.
   */
  async deletionImpact(
    id: number,
    actor: AuthUser,
  ): Promise<ProjectDeletionImpact> {
    assertMayDelete(actor);
    const impact = await projectRepository.findDeletionImpact(id, actor);
    if (!impact) throw NotFound(`Project #${id} not found`);
    return impact;
  },

  /**
   * Soft-delete a project.
   *
   * The order is load-bearing. Permission is checked FIRST, before any read, so
   * a caller without it never causes a query — the refusal cannot be told apart
   * from one for a project that does not exist, and nothing about the row leaks
   * through timing or through a 404-vs-403 difference.
   *
   * Then row scope (404), then the member guard (409). Deleting is refused while
   * anyone still routes through the project, in the same shape account closure
   * refuses while a queue is unfinished — see `HasOpenQueue`. Both say the
   * request will succeed once the thing it would strand has been moved.
   */
  async remove(id: number, actor: AuthUser): Promise<void> {
    assertMayDelete(actor, id);

    const impact = await projectRepository.findDeletionImpact(id, actor);
    if (!impact) throw NotFound(`Project #${id} not found`);
    if (impact.members > 0) throw ProjectHasMembers(impact.members);

    const deleted = await projectRepository.softDelete(id, actor, impact);
    // False means the guarded UPDATE matched nothing — someone joined the
    // project between the count above and the write. Reported as the same 409,
    // because it is the same situation and the caller's next step is the same.
    if (!deleted) throw ProjectHasMembers(impact.members || 1);
  },
};
