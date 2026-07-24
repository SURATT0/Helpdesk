import { Forbidden, NotFound } from "../../shared/errors";
import type { AuthUser } from "../../shared/auth";
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
    data: { role?: Role; teamId?: number | null },
    actor: AuthUser,
  ): Promise<UserDto> {
    // Only an admin may grant the admin role (no privilege escalation by a
    // department manager editing within their scope).
    if (data.role === "admin" && actor.role !== "admin") {
      throw Forbidden("Only an admin can grant the admin role");
    }
    // Scope is enforced in the repository (managers → own department only); an
    // out-of-scope target 404s.
    const user = await userRepository.update(id, data, actor);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  /** Self-service: the acting user edits their own profile (display name). */
  async updateProfile(
    data: { name: string },
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await userRepository.updateProfile(actor.id, data, actor.id);
    if (!user) throw NotFound(`User #${actor.id} not found`);
    return user;
  },
};
