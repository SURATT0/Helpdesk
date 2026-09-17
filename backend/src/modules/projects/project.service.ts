import { hasPermission, type AuthUser } from "../../shared/auth";
import {
  BadRequest,
  CannotOwnProject,
  NotFound,
  NotYoursToManage,
  ProjectHasMembers,
  ProjectHasOpenTickets,
  ProjectNameTaken,
} from "../../shared/errors";
import { auditRepository } from "../audit/audit.repository";
import { mayReceiveAssignment } from "../tickets/ticket.scope";
import {
  projectRepository,
  type ProjectDeletionImpact,
  type ProjectDto,
} from "./project.repository";
import {
  mustChooseProjectCustomer,
  resolveProjectCustomerId,
} from "./project.scope";

/**
 * The permission a project deletion needs.
 *
 * The starting matrix gives it to `super_admin` and to nobody else — the same
 * arrangement `ticket:delete` uses, and for the same reason: closing or
 * emptying is the normal end of something's life, and deletion is the escape
 * hatch for a row that should never have existed.
 *
 * Widening it is an edit to `role_permissions` rather than an edit here, and
 * `assertMayDelete` below asks the live grants, so such an edit takes effect
 * without this file changing.
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
  throw NotYoursToManage("projects");
}

export type CreateProjectInput = {
  name: string;
  /** Markdown, rendered on the project page. See Project.description. */
  description?: string | null;
  customerId?: number;
  ownerId?: number | null;
  backupOwnerId?: number | null;
};

export type UpdateProjectInput = {
  name?: string;
  /** Omitted leaves it as it is; explicit `null` (or empty) clears it. */
  description?: string | null;
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
      throw CannotOwnProject(userId);
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
      // Two different refusals, deliberately worded apart: one is a field the
      // caller can fill in, the other is a customer they will never be allowed
      // to name however they fill it.
      throw BadRequest(
        mustChooseProjectCustomer(actor)
          ? "customerId is required, and must be a customer you have access to"
          : "You have no customer to create a project in",
      );
    }
    await assertOwnersAssignable(actor, [input.ownerId, input.backupOwnerId]);
    // Checked here so the refusal names the project rather than a constraint.
    // The partial unique index is still what guarantees it — this only decides
    // what the caller is told, and what they are told decides whether they can
    // fix it.
    const clash = await projectRepository.findLiveByName(customerId, input.name);
    if (clash) throw ProjectNameTaken(clash.name);
    return projectRepository.create(
      {
        name: input.name,
        description: input.description,
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
    const current = await this.get(id, actor);
    await assertOwnersAssignable(actor, [input.ownerId, input.backupOwnerId]);
    // A rename collides the same way a create does, and must say so the same
    // way. Skipped when the name is not changing — including a change of case
    // on the same project, which is a rename somebody is entitled to make and
    // which a case-insensitive check would otherwise refuse against itself.
    if (input.name != null && input.name.trim() !== current.name) {
      const clash = await projectRepository.findLiveByName(
        current.customerId,
        input.name,
      );
      if (clash && clash.id !== id) throw ProjectNameTaken(clash.name);
    }
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
   * Then row scope (404), then the two guards (409). Archiving is refused while
   * anyone still routes through the project, and while live work is still filed
   * under it — the same shape account closure refuses while a queue is
   * unfinished (see `HasOpenQueue`). All of them say the request will succeed
   * once the thing it would strand has been dealt with.
   *
   * The ticket guard counts OPEN ones only. A project that ran for a year has
   * hundreds of closed tickets pointing at it and archiving strands none of
   * them: their name still renders, because the ticket DTO reads the project row
   * without filtering `deletedAt`. Counting those too would mean a routing
   * project could never be retired — which is the opposite of what a soft delete
   * is for.
   */
  async remove(id: number, actor: AuthUser): Promise<void> {
    assertMayDelete(actor, id);

    const impact = await projectRepository.findDeletionImpact(id, actor);
    if (!impact) throw NotFound(`Project #${id} not found`);
    // Members first: moving people is the cheaper fix, so it is the one to
    // name when both are true.
    if (impact.members > 0) throw ProjectHasMembers(impact.members);
    if (impact.openTickets > 0) throw ProjectHasOpenTickets(impact.openTickets);

    const deleted = await projectRepository.softDelete(id, actor, impact);
    // False means the guarded UPDATE matched nothing — somebody joined the
    // project, or filed a ticket under it, between the counts above and the
    // write. Reported as the same 409s, because it is the same situation and the
    // caller's next step is the same.
    if (!deleted) {
      throw impact.members > 0
        ? ProjectHasMembers(impact.members)
        : ProjectHasOpenTickets(impact.openTickets || 1);
    }
  },
};
