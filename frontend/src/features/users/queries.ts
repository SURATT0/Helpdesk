import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, updateUser, type UpdateUserInput } from "./api";

export const userKeys = { all: ["users"] as const };

/**
 * The user directory. `enabled: false` for callers who can't read it — the
 * endpoint requires `user:read`, so fetching it as a requester would just 403.
 */
export function useUsers(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: fetchUsers,
    enabled: opts.enabled ?? true,
  });
}

/**
 * Management edit of a user — role, team, routing project, or availability.
 *
 * Invalidates tickets as well as users: changing someone's project or marking
 * them away changes who future tickets route to, so any assignee-scoped list on
 * screen is potentially stale.
 */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateUserInput }) =>
      updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.all });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
