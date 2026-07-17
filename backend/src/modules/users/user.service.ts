import { NotFound } from "../../shared/errors";
import type { AuthUser } from "../../shared/auth";
import type { Role } from "../../shared/domain";
import { userRepository, type UserDto } from "./user.repository";

export const userService = {
  list(): Promise<UserDto[]> {
    return userRepository.findMany();
  },

  async get(id: number): Promise<UserDto> {
    const user = await userRepository.findById(id);
    if (!user) throw NotFound(`User #${id} not found`);
    return user;
  },

  async update(
    id: number,
    data: { role?: Role; teamId?: number | null },
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await userRepository.update(id, data, actor.id);
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
