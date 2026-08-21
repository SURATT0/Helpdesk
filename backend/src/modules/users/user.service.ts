import { BadRequest, Forbidden, HasOpenQueue, NotFound } from "../../shared/errors";
import { isPlatformWide, type AuthUser } from "../../shared/auth";
import type { Role } from "../../shared/domain";
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
    if (data.isActive === false) {
      // Closing your own account is never the intent — it is a locked-out
      // administrator and a support call. Refused before the scope check so the
      // message is the real reason rather than a 404.
      if (id === actor.id) {
        throw BadRequest("You cannot deactivate your own account");
      }
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
    data: { name?: string; availableForAssignment?: boolean },
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await userRepository.updateProfile(actor.id, data, actor.id);
    if (!user) throw NotFound(`User #${actor.id} not found`);
    return user;
  },
};
