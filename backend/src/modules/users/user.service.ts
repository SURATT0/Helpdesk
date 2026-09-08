import {
  BadRequest,
  Forbidden,
  HasOpenQueue,
  LastAdmin,
  NotFound,
} from "../../shared/errors";
import {
  customerReach,
  isPlatformWide,
  mayGrantReach,
  type AuthUser,
} from "../../shared/auth";
import type { Role } from "../../shared/domain";
import type { Lang } from "../../shared/i18n";
import { userRepository, type UserDto } from "./user.repository";

export const userService = {
  list(actor: AuthUser): Promise<UserDto[]> {
    return userRepository.findMany(actor);
  },

  async get(id: number, actor: AuthUser): Promise<UserDto> {
    const user = await userRepository.findById(id, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  async update(
    id: number,
    data: {
      role?: Role;
      teamId?: number | null;
      projectId?: number | null;
      availableForAssignment?: boolean;
      isActive?: boolean;
    },
    actor: AuthUser,
  ): Promise<UserDto> {
    // Granting the top role stays with the platform, not with a single customer's
    // super_admin. This is the same rule as before under the old names — it was
    // "only an admin may grant admin", and the old admin was precisely the
    // platform-wide principal. Keying on reach rather than role name is what keeps
    // it that way now that a customer's own manager shares the super_admin role:
    // otherwise they could promote themselves past their own tenant.
    if (data.role === "super_admin" && !isPlatformWide(actor)) {
      throw Forbidden("Only a platform super admin can grant the super admin role");
    }
    // Closing your own account is never the intent — it is a locked-out
    // administrator and a support call. Answered first because it is the most
    // specific thing wrong with the request: true whoever you are, and actionable
    // without knowing anything about who else holds the role.
    if (data.isActive === false && id === actor.id) {
      throw BadRequest("You cannot deactivate your own account");
    }

    /**
     * Don't let the last person who can administer something be taken away.
     *
     * Both a deactivation and a demotion do it, so the check keys on the effect
     * rather than on which field was sent. It runs before the queue check below
     * because it is the more expensive mistake: a queue can be handed over
     * afterwards, whereas the platform losing its only super admin cannot be
     * undone from inside the product — only a platform-wide super admin may grant
     * that role.
     */
    const losesTheRole =
      data.isActive === false ||
      (data.role !== undefined && data.role !== "super_admin");
    if (losesTheRole) {
      const standing = await userRepository.findAdminStanding(id);
      // A missing target is the repository's 404 to report, not this check's.
      if (standing?.role === "super_admin" && standing.others === 0) {
        throw LastAdmin(standing.customerId == null ? "platform" : "customer");
      }
    }

    if (data.isActive === false) {
      // Work still on their desk has to go somewhere first. The handover queue
      // exists for exactly this, and doing it silently here would either strand
      // the tickets on a closed account or move them without anyone choosing
      // where — so the API insists on the order instead of guessing.
      const open = await userRepository.countOpenAssigned(id, actor);
      if (open > 0) {
        throw HasOpenQueue(open);
      }
    }
    // Scope is enforced in the repository (customer-bound actors → their own
    // customer only); an out-of-scope target 404s.
    const user = await userRepository.update(id, data, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  /**
   * Self-service: the acting user edits their own profile — display name, and
   * whether they are currently accepting routed work ("I'm out"). Deliberately
   * cannot touch role, team, or project: those are management decisions.
   */
  async updateProfile(
    data: { name?: string; availableForAssignment?: boolean; language?: Lang },
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await userRepository.updateProfile(actor.id, data, actor.id);
    if (!user) throw NotFound(`User #${actor.id} not found`);
    return user;
  },

  /**
   * Set which customers a member of staff may work beyond their own.
   *
   * Platform-wide only — see `mayGrantReach`. This is the one endpoint that
   * moves someone across the tenant boundary, so anyone who could call it for
   * themselves would be their own approver, and an admin who may create a
   * customer must not also be able to walk into one.
   *
   * The rules, in the order a caller meets them:
   *   not platform-wide      → 403, before anything is read
   *   granting to yourself   → 403, even platform-wide; reach you award yourself
   *                            is not reviewed by anyone
   *   target is a requester  → 400; `ticketScopeWhere` gives role `user` their
   *                            own tickets whatever their reach, so a grant here
   *                            would be a setting that reads as effective and
   *                            does nothing
   *   unknown customer id    → 400 naming it, rather than storing a grant into a
   *                            tenant that does not exist
   *   unknown user           → 404
   */
  async setReach(
    id: number,
    customerIds: number[],
    actor: AuthUser,
  ): Promise<UserDto> {
    if (!mayGrantReach(actor)) {
      throw Forbidden(
        "Only a platform super admin can give someone access to another customer",
      );
    }
    if (id === actor.id) {
      throw Forbidden("You cannot change your own customer access");
    }

    const wanted = [...new Set(customerIds)];
    const role = await userRepository.findRole(id);
    if (role == null) throw NotFound(`User #${id} not found`);
    if (role === "user" && wanted.length > 0) {
      throw BadRequest(
        "Only staff can be given access to another customer — a requester always " +
          "sees just their own tickets",
      );
    }

    const known = new Set(await userRepository.existingCustomerIds(wanted));
    const missing = wanted.filter((c) => !known.has(c));
    if (missing.length > 0) {
      throw BadRequest(`Unknown customer #${missing[0]}`);
    }

    const user = await userRepository.setReach(id, wanted, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },
};
