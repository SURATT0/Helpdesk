import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchUsers,
  setUserReach,
  updateMyProfile,
  updateUser,
  type UpdateMyProfileInput,
  type UpdateUserInput,
} from "./api";

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

/**
 * Self-service edit of your own profile — the name on your account, or your
 * away state.
 *
 * Lives here rather than in the Settings view that calls it: `queries.ts` is
 * where this feature's server calls are, and Settings was reaching across to
 * `users/api` and `users/queries` to build the mutation itself. `onSaved`
 * receives the server's user so the caller can patch the session with the
 * answer rather than an optimistic guess — the away flag decides where real
 * tickets route.
 */
export function useUpdateMyProfile(
  onSaved?: (user: Awaited<ReturnType<typeof updateMyProfile>>) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMyProfileInput) => updateMyProfile(input),
    onSuccess: (user) => {
      onSaved?.(user);
      qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

/**
 * Set which customers a member of staff may work beyond their own.
 *
 * Invalidates far more than the directory, and deliberately: reach decides what
 * every scoped list returns, so a grant changes the ticket list, the projects,
 * the assets and the dashboard for that person. Cheaper to drop the lot than to
 * reason about which screens a tenant boundary touches.
 *
 * What it CANNOT do is refresh the granted person's own session — their reach
 * is fixed in their access token until it is renewed. That is the server's
 * behaviour, not something to paper over here.
 */
export function useSetUserReach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, customerIds }: { id: number; customerIds: number[] }) =>
      setUserReach(id, customerIds),
    onSuccess: () => qc.invalidateQueries(),
  });
}
