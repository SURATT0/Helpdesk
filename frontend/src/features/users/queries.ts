import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, updateUser, type UpdateUserInput } from "./api";

export const userKeys = { all: ["users"] as const };

export function useUsers() {
  return useQuery({ queryKey: userKeys.all, queryFn: fetchUsers });
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
